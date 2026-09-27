import type { User } from '../store/types';
import type { SessionClaims } from '../auth/jwt';

/**
 * Lets middleware attach the signed-in user (and the verified claims of the
 * token they signed in with) to the request, with full type safety.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      auth?: SessionClaims;
    }
  }
}

export {};
