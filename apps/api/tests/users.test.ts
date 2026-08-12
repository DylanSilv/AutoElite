import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { createApiClient, createCommerce, createUser, resetDatabase } from './helpers/factories.js';
import { api, apiKeyHeader, authHeader } from './helpers/request.js';

let commerce: Awaited<ReturnType<typeof createCommerce>>;
let owner: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
let staff: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDatabase();
  commerce = await createCommerce();
  owner = await createUser({ commerceId: commerce.id, role: 'OWNER' });
  manager = await createUser({ commerceId: commerce.id, role: 'MANAGER' });
  staff = await createUser({ commerceId: commerce.id, role: 'STAFF' });
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

const newUser = {
  email: 'nuevo@test.local',
  password: 'una-clave-valida',
  name: 'Nuevo',
  role: 'STAFF' as const,
};

describe('permisos sobre usuarios', () => {
  it('el personal no accede a la administración de usuarios', async () => {
    const res = await api.get('/api/v1/users').set(await authHeader(staff)).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('el dueño puede crear un encargado', async () => {
    const res = await api
      .post('/api/v1/users')
      .set(await authHeader(owner))
      .send({ ...newUser, role: 'MANAGER' })
      .expect(201);

    expect(res.body.role).toBe('MANAGER');
    expect(res.body.email).toBe(newUser.email);
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('un encargado puede crear personal', async () => {
    await api.post('/api/v1/users').set(await authHeader(manager)).send(newUser).expect(201);
  });

  it('un encargado no puede crear un dueño', async () => {
    // Si pudiera, el rol dejaría de ser una barrera: se autoascendería.
    const res = await api
      .post('/api/v1/users')
      .set(await authHeader(manager))
      .send({ ...newUser, role: 'OWNER' })
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('un encargado no puede modificar a un dueño', async () => {
    const res = await api
      .patch(`/api/v1/users/${owner.publicId}`)
      .set(await authHeader(manager))
      .send({ name: 'Renombrado' })
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('nadie puede desactivarse a sí mismo', async () => {
    const res = await api
      .patch(`/api/v1/users/${owner.publicId}`)
      .set(await authHeader(owner))
      .send({ isActive: false })
      .expect(403);

    expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
  });

  it('nadie puede cambiarse el propio rol', async () => {
    const res = await api
      .patch(`/api/v1/users/${manager.publicId}`)
      .set(await authHeader(manager))
      .send({ role: 'STAFF' })
      .expect(403);

    expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
  });

  it('una API key no administra usuarios', async () => {
    const { key } = await createApiClient({ commerceId: commerce.id });
    const res = await api.get('/api/v1/users').set(apiKeyHeader(key)).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('reglas de negocio sobre usuarios', () => {
  it('rechaza un email repetido, incluso de otro comercio', async () => {
    const otro = await createCommerce('Otra pizzería');
    const ajeno = await createUser({ commerceId: otro.id });

    const res = await api
      .post('/api/v1/users')
      .set(await authHeader(owner))
      .send({ ...newUser, email: ajeno.email })
      .expect(409);

    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('rechaza una contraseña corta', async () => {
    const res = await api
      .post('/api/v1/users')
      .set(await authHeader(owner))
      .send({ ...newUser, password: 'corta' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('password');
  });

  it('desactivar a alguien le corta las sesiones abiertas', async () => {
    await prisma.refreshToken.create({
      data: { userId: staff.id, tokenHash: 'hash-de-sesion', expiresAt: new Date(Date.now() + 1e6) },
    });

    await api
      .patch(`/api/v1/users/${staff.publicId}`)
      .set(await authHeader(owner))
      .send({ isActive: false })
      .expect(200);

    const tokens = await prisma.refreshToken.findMany({ where: { userId: staff.id } });
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
  });

  it('un PATCH vacío es un error de validación', async () => {
    await api
      .patch(`/api/v1/users/${staff.publicId}`)
      .set(await authHeader(owner))
      .send({})
      .expect(400);
  });
});

describe('paginación', () => {
  it('pagina por cursor sin repetir ni saltear filas', async () => {
    const header = await authHeader(owner);

    const first = await api.get('/api/v1/users?limit=2').set(header).expect(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.nextCursor).toBeTypeOf('string');

    const second = await api
      .get(`/api/v1/users?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .set(header)
      .expect(200);

    expect(second.body.data).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();

    const ids = [...first.body.data, ...second.body.data].map((u: { id: string }) => u.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('rechaza un límite fuera de rango', async () => {
    await api.get('/api/v1/users?limit=999').set(await authHeader(owner)).expect(400);
  });
});
