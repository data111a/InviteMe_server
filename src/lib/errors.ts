/**
 * Error handling.
 *
 * Rule for the whole app: the outside world gets a short, generic message.
 * Details (stack traces, file paths, which username exists) go to the server
 * console only - they are exactly what an attacker wants and what a guest or
 * client has no use for.
 */
import type { NextFunction, Request, Response } from 'express';

/** An error we deliberately want to show the user, e.g. "Invalid credentials". */
export class AppError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

export const badRequest = (msg = 'Invalid request') => new AppError(400, msg);
export const unauthorized = (msg = 'Not signed in') => new AppError(401, msg);
export const forbidden = (msg = 'Not allowed') => new AppError(403, msg);
export const notFound = (msg = 'Not found') => new AppError(404, msg);
export const tooLarge = (msg = 'Request too large') => new AppError(413, msg);

/** Anything that isn't a route we know about. */
export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

/** The last stop. Every thrown error in the app ends up here. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  // Errors thrown by the JSON body parser carry a `type`. Handle the ones a
  // caller can cause, with a clean status and no internals.
  if (typeof err === 'object' && err !== null && 'type' in err) {
    const type = (err as { type?: string }).type;
    if (type === 'entity.too.large') {
      res.status(413).json({ error: 'Request too large' });
      return;
    }
    if (type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
    if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
      res.status(400).json({ error: 'Unsupported encoding' });
      return;
    }
  }

  // Anything unexpected: log it for us, say nothing useful to them.
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Something went wrong' });
}
