import type { Context } from 'hono';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

export function handleError(err: Error, c: Context) {
  if (err instanceof ZodError) {
    return c.json(errorBody('VALIDATION_ERROR', 'Invalid request', err.flatten()), 400);
  }
  if (err instanceof AppError) {
    return c.json(errorBody(err.code, err.message, err.details), err.status);
  }
  if (err instanceof SyntaxError) {
    return c.json(errorBody('INVALID_JSON', 'Request body must be valid JSON'), 400);
  }
  console.error(err);
  return c.json(errorBody('INTERNAL', 'Something went wrong'), 500);
}

export function notFound(c: Context) {
  return c.json(errorBody('NOT_FOUND', 'Route not found'), 404);
}
