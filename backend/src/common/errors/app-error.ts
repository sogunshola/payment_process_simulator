export interface ValidationDetail {
  field: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly details: unknown = null,
  ) {
    super(message);
    this.name = new.target.name;
    // Keeps instanceof working even if compiled to an older target.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details: unknown = null) {
    super(message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details: unknown = null) {
    super(message, 401, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details: unknown = null) {
    super(message, 404, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details: unknown = null) {
    super(message, 409, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable', details: unknown = null) {
    super(message, 503, details);
  }
}
