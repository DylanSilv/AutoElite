import type { LoginResponse } from '@autoelite/shared';
import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { getActor } from '../../http/context.js';
import { UnauthenticatedError } from '../../shared/errors.js';
import { REFRESH_TOKEN_TTL_MS } from '../../shared/tokens.js';
import * as authService from './auth.service.js';

const REFRESH_COOKIE = 'ae_refresh';
/** Acotado a las rutas de auth: ningún otro endpoint necesita recibirlo. */
const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * El refresh token va en cookie httpOnly y el access token en el cuerpo.
 *
 * Así el access token vive en memoria del panel (no en localStorage, donde
 * cualquier XSS lo levantaría) y el refresh no es accesible desde JavaScript.
 */
function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
  });
}

function toLoginResponse(result: authService.LoginResult): LoginResponse {
  return { accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.user };
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body);
  setRefreshCookie(res, result.refreshToken);
  res.json(toLoginResponse(result));
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (typeof presented !== 'string' || !presented) {
    throw new UnauthenticatedError('UNAUTHENTICATED', 'No hay sesión activa');
  }

  try {
    const result = await authService.refresh(presented);
    setRefreshCookie(res, result.refreshToken);
    res.json(toLoginResponse(result));
  } catch (err) {
    // Si la sesión ya no sirve, no dejar la cookie dando vueltas.
    clearRefreshCookie(res);
    throw err;
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  const presented = req.cookies?.[REFRESH_COOKIE];
  await authService.logout(typeof presented === 'string' ? presented : undefined);
  clearRefreshCookie(res);
  res.status(204).send();
}

export async function me(req: Request, res: Response): Promise<void> {
  res.json(await authService.currentUser(getActor(req)));
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  await authService.changePassword(getActor(req), req.body);
  clearRefreshCookie(res);
  res.status(204).send();
}
