/**
 * The shape of everything we store.
 *
 * These types are the single description of what lives in db.json. The Zod
 * schemas at the bottom are the same description expressed as a runtime check,
 * so a hand-edited or half-written file is caught the moment we load it rather
 * than causing strange bugs hours later.
 */
import { z } from 'zod';

export const CURRENT_DB_VERSION = 1;

// --- the small vocabularies -------------------------------------------------

export const ROLES = ['admin', 'client'] as const;
export type Role = (typeof ROLES)[number];

export const EVENT_TYPES = ['birthday', 'wedding', 'corporate', 'other'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** The four kinds of question an event's form can ask. */
export const FIELD_TYPES = ['text', 'yesno', 'number', 'dropdown'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** What a yes/no field is allowed to hold. */
export const YESNO_VALUES = ['yes', 'no', 'maybe'] as const;

// --- the records ------------------------------------------------------------

/** One question on one event's RSVP form. */
export interface FieldDef {
  /** Made automatically from the label. This is what the invitation site sends. */
  key: string;
  /** What you typed, and what the dashboard column is headed. */
  label: string;
  type: FieldType;
  required: boolean;
  /** Only for type 'dropdown'. */
  options?: string[];
}

export interface User {
  id: string;
  username: string;
  /** bcrypt hash. The plain password is never stored, anywhere, ever. */
  passwordHash: string;
  role: Role;
  /** Set for clients only. Admins have null. */
  eventId: string | null;
  createdAt: string;
}

export interface EventRecord {
  id: string;
  name: string;
  type: EventType;
  eventDate: string;
  /** Long random secret. The invitation site posts answers using this. */
  intakeToken: string;
  /** This event's custom form. */
  fieldSchema: FieldDef[];
  createdAt: string;
}

export interface Answer {
  id: string;
  eventId: string;
  /** Whatever arrived: fields we defined AND any extras we did not. */
  values: Record<string, unknown>;
  submittedAt: string;
}

export interface Database {
  version: number;
  users: User[];
  events: EventRecord[];
  answers: Answer[];
}

/** A user with the password hash removed - safe to send to a browser. */
export type PublicUser = Omit<User, 'passwordHash'>;

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _omitted, ...rest } = user;
  return rest;
}

export function emptyDatabase(): Database {
  return { version: CURRENT_DB_VERSION, users: [], events: [], answers: [] };
}

// --- runtime validation -----------------------------------------------------

const isoDate = z.string().min(1);

export const fieldDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
});

const userSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  passwordHash: z.string().min(1),
  role: z.enum(ROLES),
  eventId: z.string().min(1).nullable(),
  createdAt: isoDate,
});

const eventSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(EVENT_TYPES),
  eventDate: isoDate,
  intakeToken: z.string().min(1),
  fieldSchema: z.array(fieldDefSchema),
  createdAt: isoDate,
});

const answerSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  // Deliberately permissive: answers may contain fields we never defined.
  values: z.record(z.string(), z.unknown()),
  submittedAt: isoDate,
});

export const databaseSchema = z.object({
  version: z.number().int().positive(),
  users: z.array(userSchema),
  events: z.array(eventSchema),
  answers: z.array(answerSchema),
});
