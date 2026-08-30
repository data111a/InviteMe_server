/**
 * Shared answer-reading handlers.
 *
 * These take an already-resolved event and write the response. The ADMIN routes
 * resolve the event from the URL (:id); the CLIENT routes (Phase 7) resolve it
 * from the logged-in user. Both then call the same three functions here, so the
 * admin view and the client view are guaranteed identical - same columns, same
 * numbers, same CSV.
 */
import type { Response } from 'express';

import { listAnswers } from '../store';
import type { EventRecord } from '../store/types';
import { buildCsv, buildSummary, buildView, csvFilename } from './service';

export async function sendAnswersView(event: EventRecord, res: Response): Promise<void> {
  const answers = await listAnswers(event.id);
  res.json(buildView(event, answers));
}

export async function sendAnswersSummary(event: EventRecord, res: Response): Promise<void> {
  const answers = await listAnswers(event.id);
  res.json(buildSummary(event, answers));
}

export async function sendAnswersCsv(event: EventRecord, res: Response): Promise<void> {
  const answers = await listAnswers(event.id);
  const csv = buildCsv(event, answers);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  // attachment = the browser downloads it as a file instead of showing it.
  res.setHeader('Content-Disposition', `attachment; filename="${csvFilename(event)}"`);
  res.send(csv);
}
