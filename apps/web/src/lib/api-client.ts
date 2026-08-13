import type { ApiErrorBody, ErrorCode, LoginResponse } from '@autoelite/shared';

/**
 * Cliente HTTP del panel.
 *
 * El access token vive sólo en memoria: guardarlo en localStorage haría que
 * cualquier XSS se lo lleve. El refresh viaja en una cookie httpOnly que el
 * JavaScript no puede leer, y se usa para renovar el access cuando vence.
 */

const BASE_URL = '/api/v1';

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return new ApiError(body.error.code, body.error.message, response.status, body.error.details);
  } catch {
    return new ApiError('INTERNAL_ERROR', 'No se pudo contactar al servidor', response.status);
  }
}

/**
 * Renueva el access token. Varias peticiones que fallan a la vez comparten un
 * único intento, para no disparar una tormenta de refresh.
 */
async function refreshAccessToken(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) return false;
      const body = (await response.json()) as LoginResponse;
      accessToken = body.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      // Se libera en el próximo tick para que los que esperaban vean el token.
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();

  return refreshPromise;
}

export type OnUnauthenticated = () => void;
let onUnauthenticated: OnUnauthenticated = () => undefined;

export function setUnauthenticatedHandler(handler: OnUnauthenticated): void {
  onUnauthenticated = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Uso interno: evita reintentar en bucle tras un refresh fallido. */
  retry?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, retry = true } = options;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 401 && retry) {
    // El access token dura 15 minutos: que expire en medio del servicio no
    // puede sacar al operador de la pantalla.
    if (await refreshAccessToken()) {
      return apiRequest<T>(path, { ...options, retry: false });
    }
    accessToken = null;
    onUnauthenticated();
    throw await parseError(response);
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    apiRequest<T>(path, { method: 'POST', body, headers }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

/**
 * Intenta recuperar la sesión al abrir el panel, usando la cookie de refresh.
 *
 * Antes se consulta la cookie no sensible que deja el backend: si no hay
 * sesión, no tiene sentido pedir un refresh que va a fallar.
 */
export async function restoreSession(): Promise<boolean> {
  const hasSession = document.cookie.split('; ').some((c) => c.startsWith('ae_session='));
  if (!hasSession) return false;
  return refreshAccessToken();
}
