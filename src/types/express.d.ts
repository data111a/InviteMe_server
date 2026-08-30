import type { User } from '../store/types';

/**
 * Lets middleware attach the signed-in user to the request, so route handlers
 * can read `req.user` with full type safety.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export {};
