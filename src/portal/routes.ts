/**
 * The client portal - a single client's read-only window onto their own event.
 *
 *   GET /api/my/event            details of THEIR event (safe fields only)
 *   GET /api/my/answers          the answers table
 *   GET /api/my/answers/summary  the counts
 *   GET /api/my/answers.csv      the export
 *
 * THE ONE RULE THAT MATTERS: the event is taken from req.user.eventId, which
 * comes from the login cookie the server verified - never from the URL, a query
 * or the body. There is no :id here to tamper with. A client physically cannot
 * ask for another event's data, because there is nowhere to put the request.
 *
 * Everything is GET. There is no create, edit or delete route in this file, so
 * "read only" is structural, not just a checkbox.
 */
import { Router } from 'express';

import { requireClient } from '../auth/middleware';
import { getEventById } from '../store';
import type { EventRecord } from '../store/types';
import { unauthorized } from '../lib/errors';
import { sendAnswersCsv, sendAnswersSummary, sendAnswersView } from '../answers/handlers';

export const portalRouter = Router();

portalRouter.use(requireClient);

/**
 * Load the signed-in client's event, or fail cleanly.
 *
 * requireClient already guaranteed req.user is a client WITH an eventId, but if
 * that event was deleted a moment ago the login is now dangling - we treat that
 * as "signed out" rather than showing a broken page.
 */
async function resolveOwnEvent(eventId: string): Promise<EventRecord | null> {
  return getEventById(eventId);
}

/**
 * A client must never receive the intake token (that is the secret used to SEND
 * answers - handing it over would let them forge RSVPs) nor anything about
 * their own credentials. This projection returns only what a viewer needs.
 */
function clientSafeEvent(event: EventRecord) {
  return {
    id: event.id,
    name: event.name,
    type: event.type,
    eventDate: event.eventDate,
    fieldSchema: event.fieldSchema,
  };
}

portalRouter.get('/event', async (req, res, next) => {
  try {
    const event = await resolveOwnEvent(req.user!.eventId!);
    if (!event) {
      next(unauthorized());
      return;
    }
    res.json({ event: clientSafeEvent(event) });
  } catch (err) {
    next(err);
  }
});

portalRouter.get('/answers', async (req, res, next) => {
  try {
    const event = await resolveOwnEvent(req.user!.eventId!);
    if (!event) {
      next(unauthorized());
      return;
    }
    await sendAnswersView(event, res);
  } catch (err) {
    next(err);
  }
});

portalRouter.get('/answers/summary', async (req, res, next) => {
  try {
    const event = await resolveOwnEvent(req.user!.eventId!);
    if (!event) {
      next(unauthorized());
      return;
    }
    await sendAnswersSummary(event, res);
  } catch (err) {
    next(err);
  }
});

portalRouter.get('/answers.csv', async (req, res, next) => {
  try {
    const event = await resolveOwnEvent(req.user!.eventId!);
    if (!event) {
      next(unauthorized());
      return;
    }
    await sendAnswersCsv(event, res);
  } catch (err) {
    next(err);
  }
});
