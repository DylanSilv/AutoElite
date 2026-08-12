import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { hashSecret } from '../src/shared/tokens.js';
import {
  TEST_PASSWORD,
  createCommerce,
  createUser,
  resetDatabase,
} from './helpers/factories.js';
import { api, authHeader } from './helpers/request.js';

let commerce: Awaited<ReturnType<typeof createCommerce>>;
let owner: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDatabase();
  commerce = await createCommerce();
  owner = await createUser({ commerceId: commerce.id, role: 'OWNER' });
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? (raw as string[]) : [];
}

/** Extrae la cookie del refresh token, ya sin sus atributos. */
function refreshCookie(res: { headers: Record<string, unknown> }): string {
  const cookie = setCookies(res).find((c) => c.startsWith('ae_refresh='));
  if (!cookie) throw new Error('La respuesta no trae cookie de refresh');
  return cookie.split(';')[0] ?? '';
}

describe('login', () => {
  it('devuelve access token y datos del usuario', async () => {
    const res = await api
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: TEST_PASSWORD })
      .expect(200);

    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.user.email).toBe(owner.email);
    expect(res.body.user.commerce.name).toBe(commerce.name);
    // El hash de la contraseña no puede salir nunca en una respuesta.
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('deja el refresh token en una cookie httpOnly', async () => {
    const res = await api
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: TEST_PASSWORD })
      .expect(200);

    const raw = setCookies(res).find((c) => c.startsWith('ae_refresh='));
    expect(raw).toContain('HttpOnly');
    // El refresh no debe viajar en el cuerpo, donde el JS del panel lo vería.
    expect(res.body.refreshToken).toBeUndefined();
  });

  it('rechaza la contraseña incorrecta', async () => {
    const res = await api
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: 'incorrecta-pero-larga' })
      .expect(401);

    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('no distingue email inexistente de contraseña incorrecta', async () => {
    // Mismo código y mismo mensaje: distinguirlos permite enumerar usuarios.
    const res = await api
      .post('/api/v1/auth/login')
      .send({ email: 'nadie@test.local', password: TEST_PASSWORD })
      .expect(401);

    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rechaza a un usuario desactivado', async () => {
    const disabled = await createUser({ commerceId: commerce.id, isActive: false });

    const res = await api
      .post('/api/v1/auth/login')
      .send({ email: disabled.email, password: TEST_PASSWORD })
      .expect(403);

    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('registra la fecha del último acceso', async () => {
    await api
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: TEST_PASSWORD })
      .expect(200);

    const updated = await prisma.user.findUnique({ where: { id: owner.id } });
    expect(updated?.lastLoginAt).not.toBeNull();
  });
});

describe('refresh', () => {
  it('rota el token: el anterior deja de servir', async () => {
    const login = await api
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: TEST_PASSWORD })
      .expect(200);
    const first = refreshCookie(login);

    const refreshed = await api.post('/api/v1/auth/refresh').set('Cookie', first).expect(200);
    expect(refreshed.body.accessToken).toBeTypeOf('string');

    const reused = await api.post('/api/v1/auth/refresh').set('Cookie', first).expect(401);
    expect(reused.body.error.code).toBe('TOKEN_INVALID');
  });

  it('reutilizar un token ya usado corta todas las sesiones', async () => {
    const login = await api
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: TEST_PASSWORD })
      .expect(200);
    const first = refreshCookie(login);

    const second = refreshCookie(
      await api.post('/api/v1/auth/refresh').set('Cookie', first).expect(200),
    );

    // Reaparece el token viejo: alguien tiene una copia.
    await api.post('/api/v1/auth/refresh').set('Cookie', first).expect(401);

    // Por eso el que sí era válido también queda revocado.
    await api.post('/api/v1/auth/refresh').set('Cookie', second).expect(401);
  });

  it('sin cookie devuelve 401', async () => {
    const res = await api.post('/api/v1/auth/refresh').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('un token expirado no sirve', async () => {
    const login = await api
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: TEST_PASSWORD })
      .expect(200);
    const cookie = refreshCookie(login);
    const token = cookie.split('=')[1] ?? '';

    await prisma.refreshToken.update({
      where: { tokenHash: hashSecret(decodeURIComponent(token)) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await api.post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });
});

describe('sesión', () => {
  it('logout revoca el refresh token', async () => {
    const login = await api
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: TEST_PASSWORD })
      .expect(200);
    const cookie = refreshCookie(login);

    await api.post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
    await api.post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('/me devuelve el usuario autenticado', async () => {
    const res = await api.get('/api/v1/auth/me').set(await authHeader(owner)).expect(200);
    expect(res.body.email).toBe(owner.email);
  });

  it('/me sin credenciales devuelve 401', async () => {
    const res = await api.get('/api/v1/auth/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('un token inventado no pasa', async () => {
    const res = await api
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer no-es-un-jwt')
      .expect(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('desactivar un usuario invalida su access token al instante', async () => {
    const header = await authHeader(owner);
    await api.get('/api/v1/auth/me').set(header).expect(200);

    await prisma.user.update({ where: { id: owner.id }, data: { isActive: false } });

    // No hay que esperar a que expire el token: el usuario se relee por request.
    const res = await api.get('/api/v1/auth/me').set(header).expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('cambio de contraseña', () => {
  it('cambia la contraseña y corta las demás sesiones', async () => {
    const login = await api
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: TEST_PASSWORD })
      .expect(200);
    const cookie = refreshCookie(login);

    await api
      .post('/api/v1/auth/change-password')
      .set(await authHeader(owner))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'una-clave-nueva-larga' })
      .expect(204);

    await api.post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);

    await api
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: 'una-clave-nueva-larga' })
      .expect(200);
  });

  it('rechaza si la contraseña actual no coincide', async () => {
    const res = await api
      .post('/api/v1/auth/change-password')
      .set(await authHeader(owner))
      .send({ currentPassword: 'no-es-la-actual', newPassword: 'una-clave-nueva-larga' })
      .expect(401);

    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rechaza una contraseña nueva demasiado corta', async () => {
    const res = await api
      .post('/api/v1/auth/change-password')
      .set(await authHeader(owner))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'corta' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
