/**
 * Admin-only event management.
 *
 * Every route here sits behind requireAdmin, so a client login cannot reach any
 * of it - not to read, not to change. Two details worth knowing:
 *
 *   - The intake token is NOT included when listing events. It only appears on
 *     the single-event page, where you actually need to copy it. Secrets should
 *     travel as rarely as possible.
 *   - Deleting an event deletes its answers and its client login with it, in a
 *     single write.
 */
import { Router } from 'express';
import { z } from 'zod';

import { badRequest, notFound } from '../lib/errors';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/password';
import { requireAdmin } from '../auth/middleware';
import {
  countAnswers,
  createEventWithClient,
  deleteAnswer,
  deleteEvent,
  getClientForEvent,
  getEventById,
  listEvents,
  rotateIntakeToken,
  updateEvent,
  updateEventClient,
  UsernameTakenError,
  type EventRecord,
} from '../store';
import { EVENT_TYPES } from '../store/types';
import { fieldSchemaInput, normalizeFieldSchema } from './fieldSchema';
import { sendAnswersCsv, sendAnswersSummary, sendAnswersView } from '../answers/handlers';

export const eventsRouter = Router();

eventsRouter.use(requireAdmin);

// --- shapes the browser may send --------------------------------------------

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'username must be at least 3 characters')
  .max(60)
  .regex(/^[a-zA-Z0-9._-]+$/, 'username may only use letters, numbers, dot, dash and underscore');

const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(200);

const eventDetailsSchema = z.object({
  name: z.string().trim().min(1, 'the event needs a name').max(120),
  type: z.enum(EVENT_TYPES),
  eventDate: z.string().trim().min(1, 'the event needs a date'),
  fieldSchema: fieldSchemaInput,
});

const createEventSchema = eventDetailsSchema.extend({
  client: z.object({ username: usernameSchema, password: passwordSchema }),
});

const updateEventSchema = eventDetailsSchema.partial();

const updateClientSchema = z
  .object({ username: usernameSchema.optional(), password: passwordSchema.optional() })
  .refine((v) => v.username !== undefined || v.password !== undefined, {
    message: 'nothing to change',
  });

/** Turns a Zod failure into one short, readable sentence for the admin. */
function firstProblem(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request';
  const where = issue.path.join('.');
  return where ? `${where}: ${issue.message}` : issue.message;
}

function toDateIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest('eventDate is not a real date');
  return date.toISOString();
}

// --- listing ----------------------------------------------------------------

/** Summary only - deliberately no intake token here. */
eventsRouter.get('/', async (_req, res, next) => {
  try {
    const events = await listEvents();

    const rows = await Promise.all(
      events.map(async (event) => ({
        id: event.id,
        name: event.name,
        type: event.type,
        eventDate: event.eventDate,
        createdAt: event.createdAt,
        fieldCount: event.fieldSchema.length,
        answerCount: await countAnswers(event.id),
        clientUsername: (await getClientForEvent(event.id))?.username ?? null,
      })),
    );

    res.json({ events: rows });
  } catch (err) {
    next(err);
  }
});

// --- one event --------------------------------------------------------------

async function detailPayload(event: EventRecord) {
  const client = await getClientForEvent(event.id);
  return {
    event: {
      ...event,
      answerCount: await countAnswers(event.id),
    },
    client: client ? { id: client.id, username: client.username } : null,
  };
}

eventsRouter.get('/:id', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event) {
      next(notFound());
      return;
    }
    res.json(await detailPayload(event));
  } catch (err) {
    next(err);
  }
});

// --- create -----------------------------------------------------------------

eventsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createEventSchema.safeParse(req.body);
    if (!parsed.success) {
      next(badRequest(firstProblem(parsed.error)));
      return;
    }

    const { name, type, eventDate, fieldSchema, client } = parsed.data;

    const { event } = await createEventWithClient({
      name,
      type,
      eventDate: toDateIso(eventDate),
      fieldSchema: normalizeFieldSchema(fieldSchema),
      clientUsername: client.username,
      clientPasswordHash: await hashPassword(client.password),
    });

    res.status(201).json(await detailPayload(event));
  } catch (err) {
    if (err instanceof UsernameTakenError) {
      next(badRequest('That client username is already taken'));
      return;
    }
    next(err);
  }
});

// --- edit -------------------------------------------------------------------

eventsRouter.patch('/:id', async (req, res, next) => {
  try {
    const parsed = updateEventSchema.safeParse(req.body);
    if (!parsed.success) {
      next(badRequest(firstProblem(parsed.error)));
      return;
    }

    const { name, type, eventDate, fieldSchema } = parsed.data;

    const updated = await updateEvent(req.params.id, {
      ...(name !== undefined ? { name } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(eventDate !== undefined ? { eventDate: toDateIso(eventDate) } : {}),
      ...(fieldSchema !== undefined ? { fieldSchema: normalizeFieldSchema(fieldSchema) } : {}),
    });

    if (!updated) {
      next(notFound());
      return;
    }

    res.json(await detailPayload(updated));
  } catch (err) {
    next(err);
  }
});

// --- the client login -------------------------------------------------------

eventsRouter.patch('/:id/client', async (req, res, next) => {
  try {
    const parsed = updateClientSchema.safeParse(req.body);
    if (!parsed.success) {
      next(badRequest(firstProblem(parsed.error)));
      return;
    }

    const event = await getEventById(req.params.id);
    if (!event) {
      next(notFound());
      return;
    }

    const { username, password } = parsed.data;

    const client = await updateEventClient(event.id, {
      ...(username !== undefined ? { username } : {}),
      ...(password !== undefined ? { passwordHash: await hashPassword(password) } : {}),
    });

    if (!client) {
      next(notFound());
      return;
    }

    res.json({ client: { id: client.id, username: client.username } });
  } catch (err) {
    if (err instanceof UsernameTakenError) {
      next(badRequest('That client username is already taken'));
      return;
    }
    next(err);
  }
});

// --- the intake token -------------------------------------------------------

/** Issues a new token. The old one stops working the instant this returns. */
eventsRouter.post('/:id/rotate-token', async (req, res, next) => {
  try {
    const event = await rotateIntakeToken(req.params.id);
    if (!event) {
      next(notFound());
      return;
    }
    res.json({ intakeToken: event.intakeToken });
  } catch (err) {
    next(err);
  }
});

// --- answers (admin view) ---------------------------------------------------
//
// The three read routes reuse the shared handlers, so this admin view is byte
// for byte the same as the client view built in Phase 7.

eventsRouter.get('/:id/answers', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event) {
      next(notFound());
      return;
    }
    await sendAnswersView(event, res);
  } catch (err) {
    next(err);
  }
});

eventsRouter.get('/:id/answers/summary', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event) {
      next(notFound());
      return;
    }
    await sendAnswersSummary(event, res);
  } catch (err) {
    next(err);
  }
});

eventsRouter.get('/:id/answers.csv', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event) {
      next(notFound());
      return;
    }
    await sendAnswersCsv(event, res);
  } catch (err) {
    next(err);
  }
});

/** Remove one answer (e.g. an obvious duplicate or spam that slipped through). */
eventsRouter.delete('/:id/answers/:answerId', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event) {
      next(notFound());
      return;
    }
    const removed = await deleteAnswer(req.params.answerId);
    if (!removed) {
      next(notFound());
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- delete -----------------------------------------------------------------

eventsRouter.delete('/:id', async (req, res, next) => {
  try {
    const removed = await deleteEvent(req.params.id);
    if (!removed) {
      next(notFound());
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
