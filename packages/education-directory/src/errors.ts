export class EducationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class NotFoundError extends EducationError {
  constructor(what: string) {
    super(`${what} not found`, 'NOT_FOUND');
  }
}
export class ValidationError extends EducationError {
  constructor(message: string) {
    super(message, 'VALIDATION');
  }
}
export class ConflictError extends EducationError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, code);
  }
}
export class AuthorizationError extends EducationError {
  constructor(message: string) {
    super(message, 'NOT_AUTHORIZED');
  }
}
