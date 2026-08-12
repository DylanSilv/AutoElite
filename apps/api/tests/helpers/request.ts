import type { User } from '@prisma/client';
import supertest from 'supertest';
import { createApp } from '../../src/http/app.js';
import { signAccessToken } from '../../src/shared/tokens.js';

export const app = createApp();
export const api = supertest(app);

/** Access token válido para un usuario ya creado, sin pasar por el login. */
export function tokenFor(user: User): Promise<string> {
  return signAccessToken(user.publicId);
}

export async function authHeader(user: User): Promise<{ Authorization: string }> {
  return { Authorization: `Bearer ${await tokenFor(user)}` };
}

export function apiKeyHeader(key: string): { Authorization: string } {
  return { Authorization: `Bearer ${key}` };
}
