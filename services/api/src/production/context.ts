import type { IdentityService, WorkspaceRequestContext } from '@copilot/identity';

export type Workspace = 'PARENT' | 'STUDENT' | 'TEACHER' | 'ADMIN';

export class UnauthenticatedError extends Error {
  readonly status = 401;
  constructor(message = 'invalid or expired token') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}
export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = 'forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** How a caller identifies itself to a production handler. */
export type CallerAuth =
  | { readonly bearer: string; readonly workspace: Workspace }
  /**
   * A pre-built context. ONLY honoured when the API was created with
   * `allowTrustedContext: true` — which is forced OFF whenever
   * `NODE_ENV === 'production'` (fail-closed, §2). For unit tests / local
   * deterministic fixtures only.
   */
  | { readonly trusted: WorkspaceRequestContext };

export interface ContextResolverOptions {
  readonly identityService: IdentityService;
  /** Requested via the API factory; the production guard may override to false. */
  readonly allowTrustedContext: boolean;
}

/**
 * Fail-closed: trusted contexts are never usable in production, no matter what
 * the factory was asked for.
 */
export function trustedContextAllowed(requested: boolean): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return requested;
}

export function createContextResolver(opts: ContextResolverOptions) {
  const allowTrusted = trustedContextAllowed(opts.allowTrustedContext);

  return async function deriveContext(auth: CallerAuth): Promise<WorkspaceRequestContext> {
    if ('trusted' in auth) {
      if (!allowTrusted) {
        throw new ForbiddenError('trusted context is disabled (production or not enabled)');
      }
      // even a "trusted" context must name a real user holding the workspace —
      // the client still cannot invent a userId / role out of thin air.
      const roles = await opts.identityService.listRoles(auth.trusted.userId as never);
      if (!roles.includes(auth.trusted.workspace)) {
        throw new ForbiddenError(`workspace '${auth.trusted.workspace}' is not held by this user`);
      }
      return auth.trusted;
    }
    const session = await opts.identityService.sessionContext(auth.bearer, auth.workspace);
    if (!session) throw new UnauthenticatedError();
    return session;
  };
}
