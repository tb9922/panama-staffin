/**
 * Application error classes.
 *
 * Throw these anywhere in a route or middleware — the global error handler in
 * server.js catches them and returns a consistent JSON response with the right
 * HTTP status code. Express 5 auto-forwards thrown errors in async handlers.
 */

export class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** 400 — request body or parameter failed validation */
export class ValidationError extends AppError {
  constructor(message, code = 'VALIDATION_ERROR') {
    super(message, 400, code);
  }
}

/** 401 — missing or invalid authentication token */
export class AuthenticationError extends AppError {
  constructor(message = 'Unauthorised', code = 'AUTHENTICATION_ERROR') {
    super(message, 401, code);
  }
}

/** 403 — authenticated but insufficient permissions */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

/** 404 — resource does not exist */
export class NotFoundError extends AppError {
  constructor(message, code = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

/** 409 — state conflict (e.g. duplicate record) */
export class ConflictError extends AppError {
  constructor(message, code = 'CONFLICT') {
    super(message, 409, code);
  }
}
