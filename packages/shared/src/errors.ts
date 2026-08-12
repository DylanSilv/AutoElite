/**
 * Códigos de error estables del contrato de la API.
 *
 * Son legibles por máquina a propósito: el panel web los traduce a mensajes en
 * español y, en la fase 2, el agente de IA va a reaccionar a ellos en lugar de
 * interpretar texto en prosa. Agregar códigos es seguro; renombrarlos rompe a
 * los clientes.
 */
export const ERROR_CODES = [
  // Genéricos
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_ERROR',
  'RATE_LIMITED',

  // Autenticación y autorización
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'FORBIDDEN',
  'INSUFFICIENT_SCOPE',
  'ACCOUNT_DISABLED',

  // Multi-tenant
  'COMMERCE_REQUIRED',
  'COMMERCE_INACTIVE',

  // Reglas de negocio
  'EMAIL_ALREADY_EXISTS',
  'CANNOT_MODIFY_SELF',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Forma única de todas las respuestas de error de la API. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
}
