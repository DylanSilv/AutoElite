import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { forCommerce } from '../src/db/tenant.js';
import {
  createApiClient,
  createTwoCommerces,
  createUser,
  resetDatabase,
} from './helpers/factories.js';
import { api, apiKeyHeader, authHeader } from './helpers/request.js';

/**
 * El aislamiento entre comercios es la propiedad que no se puede romper nunca:
 * una fuga acá significa que una pizzería ve los datos de otra.
 *
 * Se prueba en los dos niveles, porque protegen contra fallas distintas: la
 * capa HTTP cubre lo que expone la API hoy, y la capa de acceso a datos cubre
 * el código que todavía no se escribió.
 */

let scenario: Awaited<ReturnType<typeof createTwoCommerces>>;

beforeEach(async () => {
  await resetDatabase();
  scenario = await createTwoCommerces();
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

describe('aislamiento en la capa HTTP', () => {
  it('el listado de usuarios sólo devuelve los del propio comercio', async () => {
    const res = await api.get('/api/v1/users').set(await authHeader(scenario.ownerA)).expect(200);

    const emails: string[] = res.body.data.map((u: { email: string }) => u.email);
    expect(emails).toHaveLength(2);
    expect(emails).toContain(scenario.ownerA.email);
    expect(emails).toContain(scenario.staffA.email);
    expect(emails).not.toContain(scenario.ownerB.email);
    expect(emails).not.toContain(scenario.staffB.email);
  });

  it('pedir un usuario de otro comercio devuelve 404, no 403', async () => {
    // 404 y no 403 a propósito: un 403 confirmaría que ese id existe.
    const res = await api
      .get(`/api/v1/users/${scenario.staffB.publicId}`)
      .set(await authHeader(scenario.ownerA))
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('no se puede modificar un usuario de otro comercio', async () => {
    await api
      .patch(`/api/v1/users/${scenario.staffB.publicId}`)
      .set(await authHeader(scenario.ownerA))
      .send({ name: 'Intruso' })
      .expect(404);

    const untouched = await prisma.user.findUnique({ where: { id: scenario.staffB.id } });
    expect(untouched?.name).toBe('Usuario de prueba');
  });

  it('el comercio devuelto es siempre el del token', async () => {
    const [resA, resB] = await Promise.all([
      api.get('/api/v1/commerce').set(await authHeader(scenario.ownerA)).expect(200),
      api.get('/api/v1/commerce').set(await authHeader(scenario.ownerB)).expect(200),
    ]);

    expect(resA.body.name).toBe('Pizzería A');
    expect(resB.body.name).toBe('Pizzería B');
  });

  it('una API key sólo ve las credenciales de su propio comercio', async () => {
    const res = await api
      .get('/api/v1/api-clients')
      .set(apiKeyHeader(scenario.apiA.key))
      // Las API keys no administran credenciales: eso es del dueño.
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('revocar una credencial de otro comercio devuelve 404', async () => {
    await api
      .post(`/api/v1/api-clients/${scenario.apiB.client.publicId}/revoke`)
      .set(await authHeader(scenario.ownerA))
      .expect(404);

    const untouched = await prisma.apiClient.findUnique({
      where: { id: scenario.apiB.client.id },
    });
    expect(untouched?.revokedAt).toBeNull();
  });

  it('una API key revocada deja de autenticar', async () => {
    await prisma.apiClient.update({
      where: { id: scenario.apiA.client.id },
      data: { revokedAt: new Date() },
    });

    const res = await api
      .get('/api/v1/commerce')
      .set(apiKeyHeader(scenario.apiA.key))
      .expect(401);

    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });
});

describe('aislamiento en la capa de acceso a datos', () => {
  it('findMany sólo alcanza filas del comercio', async () => {
    const users = await forCommerce(scenario.commerceA.id).user.findMany();
    expect(users.map((u) => u.id).sort()).toEqual(
      [scenario.ownerA.id, scenario.staffA.id].sort(),
    );
  });

  it('findUnique por un id de otro comercio devuelve null', async () => {
    // Depende de que Prisma acepte filtros no únicos junto a la clave única;
    // si dejara de hacerlo, este test lo detecta antes que un incidente.
    const found = await forCommerce(scenario.commerceA.id).user.findUnique({
      where: { id: scenario.staffB.id },
    });
    expect(found).toBeNull();
  });

  it('findUnique por publicId de otro comercio devuelve null', async () => {
    const found = await forCommerce(scenario.commerceA.id).user.findUnique({
      where: { publicId: scenario.staffB.publicId },
    });
    expect(found).toBeNull();
  });

  it('count no cuenta filas de otro comercio', async () => {
    await createUser({ commerceId: scenario.commerceB.id });
    const total = await forCommerce(scenario.commerceA.id).user.count();
    expect(total).toBe(2);
  });

  it('update sobre una fila de otro comercio no modifica nada', async () => {
    await expect(
      forCommerce(scenario.commerceA.id).user.update({
        where: { id: scenario.staffB.id },
        data: { name: 'Intruso' },
      }),
    ).rejects.toThrow();

    const untouched = await prisma.user.findUnique({ where: { id: scenario.staffB.id } });
    expect(untouched?.name).toBe('Usuario de prueba');
  });

  it('updateMany sin where no toca filas de otro comercio', async () => {
    // El caso peligroso de verdad: un update masivo al que se le olvidó el filtro.
    const result = await forCommerce(scenario.commerceA.id).user.updateMany({
      data: { name: 'Renombrado' },
    });

    expect(result.count).toBe(2);
    const b = await prisma.user.findUnique({ where: { id: scenario.staffB.id } });
    expect(b?.name).toBe('Usuario de prueba');
  });

  it('deleteMany sin where no borra filas de otro comercio', async () => {
    await forCommerce(scenario.commerceA.id).apiClient.deleteMany();

    const remaining = await prisma.apiClient.findMany();
    expect(remaining.map((c) => c.commerceId)).toEqual([scenario.commerceB.id]);
  });

  it('create fuerza el comercio del contexto aunque se pase otro', async () => {
    // La red de seguridad: aunque el código de arriba mande el comercio
    // equivocado, la extensión lo sobrescribe con el del contexto.
    const created = await forCommerce(scenario.commerceA.id).apiClient.create({
      data: {
        name: 'Intento cruzado',
        keyHash: 'hash-de-prueba-unico',
        scopes: [],
        commerceId: scenario.commerceB.id,
      },
    });

    expect(created.commerceId).toBe(scenario.commerceA.id);
  });

  it('createMany también recibe el comercio del contexto', async () => {
    await forCommerce(scenario.commerceA.id).apiClient.createMany({
      // Se omite el `commerceId` a propósito —es el caso que se quiere probar—
      // y por eso hace falta el cast: los tipos de Prisma lo exigen, la
      // extensión lo completa en tiempo de ejecución.
      data: [
        { name: 'Lote 1', keyHash: 'hash-lote-1', scopes: [] },
        { name: 'Lote 2', keyHash: 'hash-lote-2', scopes: [] },
      ] as unknown as Prisma.ApiClientCreateManyInput[],
    });

    const created = await prisma.apiClient.findMany({
      where: { name: { in: ['Lote 1', 'Lote 2'] } },
    });
    expect(created).toHaveLength(2);
    expect(created.every((c) => c.commerceId === scenario.commerceA.id)).toBe(true);
  });

  it('el cliente sin acotar sí ve todo (control del propio test)', async () => {
    // Si este test fallara, los anteriores podrían estar pasando por vacío.
    const all = await prisma.user.findMany();
    expect(all).toHaveLength(4);
  });
});

describe('usuarios sin comercio', () => {
  it('un PLATFORM_ADMIN no puede operar sobre rutas de comercio', async () => {
    const admin = await createUser({ commerceId: null, role: 'PLATFORM_ADMIN' });

    const res = await api.get('/api/v1/commerce').set(await authHeader(admin)).expect(403);
    expect(res.body.error.code).toBe('COMMERCE_REQUIRED');
  });

  it('una credencial de un comercio desactivado no autentica', async () => {
    await prisma.commerce.update({
      where: { id: scenario.commerceA.id },
      data: { isActive: false },
    });
    const { key } = await createApiClient({ commerceId: scenario.commerceA.id });

    const res = await api.get('/api/v1/commerce').set(apiKeyHeader(key)).expect(403);
    expect(res.body.error.code).toBe('COMMERCE_INACTIVE');
  });
});
