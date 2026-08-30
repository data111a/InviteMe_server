/**
 * The MongoDB Atlas connection layer.
 *
 * Nothing outside src/store/ imports this. It owns the single MongoClient for
 * the whole process, hands out typed collections, and creates the indexes the
 * store relies on for correctness (uniqueness) and speed.
 *
 * Swapping the store from the old JSON file to Atlas is contained to this file
 * and store/index.ts — routes, auth and everything else are untouched.
 */
import { MongoClient, type Collection, type Db } from 'mongodb';

import { env } from '../env';
import type { Answer, EventRecord, User } from './types';

/**
 * Case-insensitive collation for usernames: "Admin" and "admin" are the same
 * login. Applied to the unique index and to every username lookup, so it stays
 * consistent with the old file store's `.toLowerCase()` comparison.
 */
export const CI_COLLATION = { locale: 'en', strength: 2 } as const;

let client: MongoClient | null = null;
let db: Db | null = null;

function requireDb(): Db {
  if (!db) throw new Error('MongoDB is not connected yet - call initStore() first.');
  return db;
}

export function usersCol(): Collection<User> {
  return requireDb().collection<User>('users');
}
export function eventsCol(): Collection<EventRecord> {
  return requireDb().collection<EventRecord>('events');
}
export function answersCol(): Collection<Answer> {
  return requireDb().collection<Answer>('answers');
}

/** The client itself, for multi-document transactions and scripts. */
export function mongoClient(): MongoClient {
  if (!client) throw new Error('MongoDB is not connected yet - call initStore() first.');
  return client;
}

/**
 * Connect once, verify the connection with a ping, and ensure indexes exist.
 * Called at startup (and by the seed/migrate/show scripts) BEFORE anything
 * reads or writes, so an unreachable cluster fails fast with a clear message
 * instead of hanging mid-request.
 */
export async function connectMongo(): Promise<void> {
  if (db) return;

  const c = new MongoClient(env.MONGODB_URI, {
    // Fail fast (wrong URI, IP not allow-listed, network down) rather than hang.
    serverSelectionTimeoutMS: 8000,
    appName: 'systemui-server',
  });

  await c.connect();
  await c.db(env.MONGODB_DB).command({ ping: 1 });

  client = c;
  db = c.db(env.MONGODB_DB);

  await ensureIndexes();
}

async function ensureIndexes(): Promise<void> {
  await Promise.all([
    // One account per id; usernames unique, case-insensitively.
    usersCol().createIndex({ id: 1 }, { unique: true }),
    usersCol().createIndex({ username: 1 }, { unique: true, collation: CI_COLLATION }),
    usersCol().createIndex({ role: 1, eventId: 1 }),

    eventsCol().createIndex({ id: 1 }, { unique: true }),
    eventsCol().createIndex({ intakeToken: 1 }, { unique: true }),
    eventsCol().createIndex({ createdAt: -1 }),

    answersCol().createIndex({ id: 1 }, { unique: true }),
    answersCol().createIndex({ eventId: 1, submittedAt: -1 }),
  ]);
}

/** Close the connection. Scripts must call this so the process can exit. */
export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

/** True when an error is a duplicate-key (unique index) violation. */
export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/** A short, secret-free description of what we connected to, for logs. */
export function mongoTarget(): string {
  const host = env.MONGODB_URI.replace(/^mongodb(\+srv)?:\/\//, '')
    .replace(/^[^@]*@/, '')
    .split(/[/?]/)[0];
  return `${env.MONGODB_DB} @ ${host || '(host)'}`;
}
