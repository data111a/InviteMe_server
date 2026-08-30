/**
 * The store - the only module in the app that knows where data lives.
 *
 * Routes call these functions and know nothing about MongoDB, collections or
 * connection strings. Every function keeps the exact signature it had over the
 * old JSON file, so moving to MongoDB Atlas changed THIS FILE and mongo.ts only.
 *
 * Two house rules keep the domain objects clean:
 *   - reads project out Mongo's internal `_id`, so what routes return matches
 *     the app's own `id`-based types (and no ObjectId leaks into JSON);
 *   - writes insert a shallow copy, so the object we return to the caller never
 *     gets Mongo's `_id` stamped onto it.
 */
import { newId, newIntakeToken } from '../lib/ids';
import {
  answersCol,
  CI_COLLATION,
  eventsCol,
  isDuplicateKeyError,
  mongoClient,
  usersCol,
} from './mongo';
import type { Answer, EventRecord, EventType, FieldDef, Role, User } from './types';

export { connectMongo as initStore, closeMongo, mongoTarget } from './mongo';
export * from './types';

/** Drop Mongo's internal id from every read, so results match the app types. */
const NO_ID = { _id: 0 } as const;

const nowIso = () => new Date().toISOString();

/** Thrown when a username is already in use. Routes turn this into a 400. */
export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`username "${username}" is already taken`);
    this.name = 'UsernameTakenError';
  }
}

// --- users ------------------------------------------------------------------

export async function getUserByUsername(username: string): Promise<User | null> {
  return usersCol().findOne(
    { username: username.trim() },
    { projection: NO_ID, collation: CI_COLLATION },
  );
}

export async function getUserById(id: string): Promise<User | null> {
  return usersCol().findOne({ id }, { projection: NO_ID });
}

/** The single client login attached to an event, if one exists. */
export async function getClientForEvent(eventId: string): Promise<User | null> {
  return usersCol().findOne({ role: 'client', eventId }, { projection: NO_ID });
}

export async function listUsers(): Promise<User[]> {
  return usersCol().find({}, { projection: NO_ID }).toArray();
}

export async function createUser(input: {
  username: string;
  passwordHash: string;
  role: Role;
  eventId?: string | null;
}): Promise<User> {
  const user: User = {
    id: newId('u'),
    username: input.username.trim(),
    passwordHash: input.passwordHash,
    role: input.role,
    eventId: input.role === 'client' ? (input.eventId ?? null) : null,
    createdAt: nowIso(),
  };

  try {
    await usersCol().insertOne({ ...user });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new Error('username already taken');
    throw err;
  }
  return user;
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<User, 'username' | 'passwordHash'>>,
): Promise<User | null> {
  const set: Partial<Pick<User, 'username' | 'passwordHash'>> = {};
  if (patch.username !== undefined) set.username = patch.username.trim();
  if (patch.passwordHash !== undefined) set.passwordHash = patch.passwordHash;

  if (Object.keys(set).length === 0) return getUserById(id);

  try {
    return await usersCol().findOneAndUpdate(
      { id },
      { $set: set },
      { returnDocument: 'after', projection: NO_ID },
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new Error('username already taken');
    throw err;
  }
}

// --- events -----------------------------------------------------------------

export async function listEvents(): Promise<EventRecord[]> {
  return eventsCol()
    .find({}, { projection: NO_ID, sort: { createdAt: -1 } })
    .toArray();
}

export async function getEventById(id: string): Promise<EventRecord | null> {
  return eventsCol().findOne({ id }, { projection: NO_ID });
}

export async function getEventByToken(token: string): Promise<EventRecord | null> {
  return eventsCol().findOne({ intakeToken: token }, { projection: NO_ID });
}

/**
 * Creates an event AND its single client login in ONE transaction.
 *
 * They are created together on purpose. The rule "every event has exactly one
 * client login" cannot be broken: either both documents land, or neither does
 * (a taken username rolls the whole thing back). Uniqueness is enforced by the
 * username index, so there is no check-then-insert race.
 */
export async function createEventWithClient(input: {
  name: string;
  type: EventType;
  eventDate: string;
  fieldSchema: FieldDef[];
  clientUsername: string;
  clientPasswordHash: string;
}): Promise<{ event: EventRecord; client: User }> {
  const event: EventRecord = {
    id: newId('e'),
    name: input.name,
    type: input.type,
    eventDate: input.eventDate,
    intakeToken: newIntakeToken(),
    fieldSchema: input.fieldSchema,
    createdAt: nowIso(),
  };

  const client: User = {
    id: newId('u'),
    username: input.clientUsername.trim(),
    passwordHash: input.clientPasswordHash,
    role: 'client',
    eventId: event.id,
    createdAt: nowIso(),
  };

  const session = mongoClient().startSession();
  try {
    await session.withTransaction(async () => {
      // Insert the client first: a taken username aborts before anything commits.
      await usersCol().insertOne({ ...client }, { session });
      await eventsCol().insertOne({ ...event }, { session });
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new UsernameTakenError(client.username);
    throw err;
  } finally {
    await session.endSession();
  }

  return { event, client };
}

/** Change an event's client login: username, password, or both. */
export async function updateEventClient(
  eventId: string,
  patch: { username?: string; passwordHash?: string },
): Promise<User | null> {
  const set: Partial<Pick<User, 'username' | 'passwordHash'>> = {};
  if (patch.username !== undefined) set.username = patch.username.trim();
  if (patch.passwordHash !== undefined) set.passwordHash = patch.passwordHash;

  if (Object.keys(set).length === 0) return getClientForEvent(eventId);

  try {
    return await usersCol().findOneAndUpdate(
      { role: 'client', eventId },
      { $set: set },
      { returnDocument: 'after', projection: NO_ID },
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new UsernameTakenError(patch.username ?? '');
    throw err;
  }
}

export async function updateEvent(
  id: string,
  patch: Partial<Pick<EventRecord, 'name' | 'type' | 'eventDate' | 'fieldSchema'>>,
): Promise<EventRecord | null> {
  const set: Partial<Pick<EventRecord, 'name' | 'type' | 'eventDate' | 'fieldSchema'>> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.eventDate !== undefined) set.eventDate = patch.eventDate;
  if (patch.fieldSchema !== undefined) set.fieldSchema = patch.fieldSchema;

  if (Object.keys(set).length === 0) return getEventById(id);

  return eventsCol().findOneAndUpdate(
    { id },
    { $set: set },
    { returnDocument: 'after', projection: NO_ID },
  );
}

/** Issue a fresh intake token. The old one stops working immediately. */
export async function rotateIntakeToken(id: string): Promise<EventRecord | null> {
  return eventsCol().findOneAndUpdate(
    { id },
    { $set: { intakeToken: newIntakeToken() } },
    { returnDocument: 'after', projection: NO_ID },
  );
}

/** Deletes the event, its answers, and its client login together (one transaction). */
export async function deleteEvent(id: string): Promise<boolean> {
  const session = mongoClient().startSession();
  let removed = false;
  try {
    await session.withTransaction(async () => {
      const res = await eventsCol().deleteOne({ id }, { session });
      if (res.deletedCount === 0) {
        removed = false;
        return;
      }
      await answersCol().deleteMany({ eventId: id }, { session });
      await usersCol().deleteOne({ role: 'client', eventId: id }, { session });
      removed = true;
    });
  } finally {
    await session.endSession();
  }
  return removed;
}

// --- answers ----------------------------------------------------------------

export async function createAnswer(
  eventId: string,
  values: Record<string, unknown>,
): Promise<Answer> {
  const answer: Answer = {
    id: newId('a'),
    eventId,
    values,
    submittedAt: nowIso(),
  };

  await answersCol().insertOne({ ...answer });
  return answer;
}

/** Newest first. */
export async function listAnswers(eventId: string): Promise<Answer[]> {
  return answersCol()
    .find({ eventId }, { projection: NO_ID, sort: { submittedAt: -1 } })
    .toArray();
}

export async function countAnswers(eventId: string): Promise<number> {
  return answersCol().countDocuments({ eventId });
}

export async function deleteAnswer(id: string): Promise<boolean> {
  const res = await answersCol().deleteOne({ id });
  return res.deletedCount > 0;
}
