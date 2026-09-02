/** Base for all identity-domain failures. */
export class IdentityError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends IdentityError {
  constructor(what: string) {
    super(`${what} not found`, 'NOT_FOUND');
  }
}

export class WorkspaceNotHeldError extends IdentityError {
  constructor(role: string) {
    super(`workspace '${role}' is not a role this user holds`, 'WORKSPACE_NOT_HELD');
  }
}

export class AuthorizationError extends IdentityError {
  constructor(message: string) {
    super(message, 'NOT_AUTHORIZED');
  }
}

export class ValidationError extends IdentityError {
  constructor(message: string) {
    super(message, 'VALIDATION');
  }
}

export class ConflictError extends IdentityError {
  constructor(message: string) {
    super(message, 'CONFLICT');
  }
}
