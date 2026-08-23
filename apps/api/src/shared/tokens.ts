import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { env } from '../config/env.js';
import { UnauthenticatedError } from './errors.js';

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export const ACCESS_TOKEN_TTL_SECONDS = env.ACCESS_TOKEN_TTL_MINUTES * 60;
export const REFRESH_TOKEN_TTL_MS = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface AccessTokenPayload {
  /** publicId del usuario. */
  sub: string;
}

export async function signAccessToken(userPublicId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userPublicId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(accessSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, { algorithms: ['HS256'] });
    if (!payload.sub) throw new UnauthenticatedError('TOKEN_INVALID', 'Token sin sujeto');
    return { sub: payload.sub };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new UnauthenticatedError('TOKEN_EXPIRED', 'El token expiró');
    }
    if (err instanceof UnauthenticatedError) throw err;
    throw new UnauthenticatedError('TOKEN_INVALID', 'Token inválido');
  }
}

/**
 * Los refresh tokens y las API keys son cadenas aleatorias de alta entropía, no
 * contraseñas elegidas por humanos: SHA-256 alcanza y evita el costo de Argon2
 * en cada request. Argon2 se justifica sólo contra fuerza bruta sobre secretos
 * adivinables.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashSecret(token) };
}

const API_KEY_PREFIX = 'ae_';

export function generateApiKey(): { key: string; keyHash: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { key, keyHash: hashSecret(key) };
}

/** Comparación en tiempo constante, para no filtrar información por timing. */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
