import type { ErrorCode } from '@autoelite/shared';

/**
 * Error de dominio. Los services lanzan estos; el middleware de errores es el
 * único lugar del backend que conoce códigos HTTP.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Datos inválidos', details?: unknown) {
    super('VALIDATION_ERROR', 400, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado', details?: unknown) {
    super('NOT_FOUND', 404, message, details);
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(code, 409, message, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(code: ErrorCode = 'UNAUTHENTICATED', message = 'No autenticado') {
    super(code, 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(code: ErrorCode = 'FORBIDDEN', message = 'No autorizado', details?: unknown) {
    super(code, 403, message, details);
  }
}

export class BusinessRuleError extends AppError {
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(code, 422, message, details);
  }
}
