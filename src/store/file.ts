/**
 * The crash-safe JSON file layer.
 *
 * Nothing outside src/store/ imports this. It does three jobs:
 *
 *   1. Load db.json once, check its shape, and keep it in memory.
 *   2. Let callers change it through mutate(), one change at a time.
 *   3. Write it back in a way a power cut cannot leave half-finished.
 *
 * The whole file is rewritten on every change. That is fine for the scale this
 * app works at (see PLAN.md section 4) and it is what makes the swap to a real
 * database later a rewrite of ONE module.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { env } from '../env';
import { type Database, databaseSchema, emptyDatabase } from './types';

const DB_PATH = resolve(process.cwd(), env.DATA_FILE);
const TMP_PATH = `${DB_PATH}.tmp`;
const BAK_PATH = `${DB_PATH}.bak`;

export const dbPath = DB_PATH;
export const backupPath = BAK_PATH;

/** Thrown when db.json exists but is not readable data. Never swallowed. */
export class CorruptDatabaseError extends Error {
  constructor(detail: string) {
    super(
      [
        `The data file could not be read: ${detail}`,
        '',
        `  file:   ${DB_PATH}`,
        `  backup: ${BAK_PATH}`,
        '',
        '  The server has NOT started, so nothing has been overwritten.',
        '  If the backup looks right, copy it over the data file and start again.',
      ].join('\n'),
    );
    this.name = 'CorruptDatabaseError';
  }
}

// --- loading ----------------------------------------------------------------

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

async function loadFromDisk(): Promise<Database> {
  await mkdir(dirname(DB_PATH), { recursive: true });

  let raw: string;
  try {
    raw = await readFile(DB_PATH, 'utf8');
  } catch (err) {
    if (isNotFound(err)) {
      // First ever run. Start empty and write it so the file visibly exists.
      const fresh = emptyDatabase();
      await writeToDisk(fresh);
      return fresh;
    }
    throw err;
  }

  // Some Windows editors (Notepad, PowerShell's Set-Content) save a UTF-8 BOM:
  // an invisible marker at the very start. JSON.parse chokes on it. Since the
  // whole point of a JSON file is that you can open and read it, quietly drop it.
  const text = raw.replace(/^﻿/, '');

  if (text.trim() === '') throw new CorruptDatabaseError('the file is empty');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new CorruptDatabaseError(`it is not valid JSON (${(err as Error).message})`);
  }

  // Shape check. Catches a hand-edit that deleted a field or broke a type.
  const checked = databaseSchema.safeParse(parsed);
  if (!checked.success) {
    const first = checked.error.issues[0];
    const where = first ? first.path.join('.') || '(root)' : '(unknown)';
    const why = first ? first.message : 'unknown problem';
    throw new CorruptDatabaseError(`its contents are not the expected shape - "${where}": ${why}`);
  }

  return checked.data as Database;
}

// --- writing ----------------------------------------------------------------

/**
 * Write so that the file on disk is only ever the complete old version or the
 * complete new one:
 *   1. write the new version to a temp file and flush it to the physical disk
 *   2. copy the current file to .bak
 *   3. rename the temp file over the real one - a single, instant operation
 */
async function writeToDisk(db: Database): Promise<void> {
  const json = JSON.stringify(db, null, 2);

  const handle = await open(TMP_PATH, 'w');
  try {
    await handle.writeFile(json, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  if (existsSync(DB_PATH)) await copyFile(DB_PATH, BAK_PATH);

  await rename(TMP_PATH, DB_PATH);
}

// --- the queue --------------------------------------------------------------

/**
 * Every change runs to completion before the next one starts, so two answers
 * arriving at the same instant can never interleave and lose one another.
 */
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined); // one failure must not poison the queue
  return run;
}

// --- the in-memory copy -----------------------------------------------------

let cache: Database | null = null;

async function getCache(): Promise<Database> {
  if (!cache) cache = await loadFromDisk();
  return cache;
}

/**
 * Load and validate at startup, so a broken file stops the server immediately
 * instead of surfacing halfway through someone's request.
 */
export async function initStore(): Promise<void> {
  await getCache();
}

/** Read something out. The result is a copy - callers cannot corrupt the cache. */
export async function read<T>(selector: (db: Database) => T): Promise<T> {
  const db = await getCache();
  return structuredClone(selector(db));
}

/**
 * Change something. The change is applied to a copy; the in-memory version is
 * only replaced once the new file is safely on disk. If anything throws, the
 * previous state survives untouched.
 */
export async function mutate<T>(change: (db: Database) => T | Promise<T>): Promise<T> {
  return enqueue(async () => {
    const current = await getCache();
    const draft = structuredClone(current);
    const result = await change(draft);
    await writeToDisk(draft);
    cache = draft;
    return structuredClone(result);
  });
}
