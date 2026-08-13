import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import {
  createCatalog,
  createCommerce,
  createCustomer,
  createUser,
  resetDatabase,
} from './helpers/factories.js';
import { api, authHeader } from './helpers/request.js';

let commerce: Awaited<ReturnType<typeof createCommerce>>;
let user: Awaited<ReturnType<typeof createUser>>;
let catalog: Awaited<ReturnType<typeof createCatalog>>;
let auth: { Authorization: string };

beforeEach(async () => {
  await resetDatabase();
  commerce = await createCommerce();
  user = await createUser({ commerceId: commerce.id, role: 'OWNER' });
  catalog = await createCatalog(commerce.id);
  auth = await authHeader(user);
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

function takeawayOrder(overrides: Record<string, unknown> = {}) {
  return {
    type: 'TAKEAWAY',
    customerName: 'Martina',
    items: [{ variantId: catalog.pizzaGrande.publicId, quantity: 1 }],
    ...overrides,
  };
}

describe('cotización', () => {
  it('calcula el total con extras y envío', async () => {
    const res = await api
      .post('/api/v1/orders/quote')
      .set(auth)
      .send({
        type: 'DELIVERY',
        items: [
          {
            variantId: catalog.pizzaGrande.publicId,
            quantity: 2,
            modifierOptionIds: [catalog.extras.options[0]!.publicId],
          },
          { variantId: catalog.drinkVariant.publicId, quantity: 1 },
        ],
        address: { street: 'Rivadavia', number: '100', deliveryZoneId: catalog.zone.publicId },
      })
      .expect(200);

    // (14500 + 900) * 2 + 3500 = 34400, más 1500 de envío
    expect(res.body.subtotalCents).toBe(3_430_000);
    expect(res.body.deliveryFeeCents).toBe(150_000);
    expect(res.body.totalCents).toBe(3_580_000);
  });

  it('no persiste nada', async () => {
    await api.post('/api/v1/orders/quote').set(auth).send(takeawayOrder()).expect(200);
    expect(await prisma.order.count()).toBe(0);
  });

  it('rechaza un producto no disponible', async () => {
    await prisma.productVariant.update({
      where: { id: catalog.pizzaGrande.id },
      data: { isAvailable: false },
    });

    const res = await api.post('/api/v1/orders/quote').set(auth).send(takeawayOrder()).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('el precio sale de la base, no de lo que manda el cliente', async () => {
    const res = await api
      .post('/api/v1/orders/quote')
      .set(auth)
      .send({ ...takeawayOrder(), subtotalCents: 1, totalCents: 1 })
      .expect(200);

    expect(res.body.totalCents).toBe(1_450_000);
  });
});

describe('creación de pedidos', () => {
  it('crea el pedido con número correlativo', async () => {
    const first = await api.post('/api/v1/orders').set(auth).send(takeawayOrder()).expect(201);
    const second = await api.post('/api/v1/orders').set(auth).send(takeawayOrder()).expect(201);

    expect(first.body.number).toBe(1);
    expect(second.body.number).toBe(2);
    expect(first.body.status).toBe('PENDIENTE');
  });

  it('congela nombre y precio en cada línea', async () => {
    const created = await api.post('/api/v1/orders').set(auth).send(takeawayOrder()).expect(201);

    // Sube el precio del catálogo después de tomar el pedido.
    await prisma.productVariant.update({
      where: { id: catalog.pizzaGrande.id },
      data: { priceCents: 9_999_900 },
    });

    const reloaded = await api.get(`/api/v1/orders/${created.body.id}`).set(auth).expect(200);

    // El pedido viejo sigue valiendo lo que se cobró: cambiar un precio no
    // puede reescribir el pasado ni distorsionar las métricas.
    expect(reloaded.body.items[0].unitPriceCents).toBe(1_450_000);
    expect(reloaded.body.totalCents).toBe(1_450_000);
  });

  it('exige dirección en un envío', async () => {
    const res = await api
      .post('/api/v1/orders')
      .set(auth)
      .send(takeawayOrder({ type: 'DELIVERY' }))
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('guarda la dirección como copia', async () => {
    const res = await api
      .post('/api/v1/orders')
      .set(auth)
      .send(
        takeawayOrder({
          type: 'DELIVERY',
          address: {
            street: 'Rivadavia',
            number: '4520',
            reference: 'Timbre 3B',
            deliveryZoneId: catalog.zone.publicId,
          },
        }),
      )
      .expect(201);

    expect(res.body.address.street).toBe('Rivadavia');
    expect(res.body.address.zoneName).toBe(catalog.zone.name);
    expect(res.body.deliveryFeeCents).toBe(150_000);
  });

  it('reconoce a un cliente existente por teléfono', async () => {
    const existing = await createCustomer({
      commerceId: commerce.id,
      phone: '+59899123456',
      name: 'Martina Silva',
    });

    const res = await api
      .post('/api/v1/orders')
      .set(auth)
      .send(takeawayOrder({ customerPhone: '099 123 456', customerName: 'Otro nombre' }))
      .expect(201);

    // El teléfono es la identidad: escrito de otra forma sigue siendo la misma
    // persona, y no se duplica la ficha.
    expect(res.body.customerName).toBe('Martina Silva');
    expect(await prisma.customer.count()).toBe(1);

    const stats = await prisma.customer.findUnique({ where: { id: existing.id } });
    expect(stats?.ordersCount).toBe(1);
  });

  it('crea el cliente si el teléfono es nuevo', async () => {
    await api
      .post('/api/v1/orders')
      .set(auth)
      .send(takeawayOrder({ customerPhone: '094 567 890', customerName: 'Nuevo Cliente' }))
      .expect(201);

    const customer = await prisma.customer.findFirst({ where: { phoneE164: '+59894567890' } });
    expect(customer?.name).toBe('Nuevo Cliente');
  });
});

describe('idempotencia', () => {
  it('un reintento con la misma clave no duplica el pedido', async () => {
    const key = 'n8n-reintento-1';

    const first = await api
      .post('/api/v1/orders')
      .set(auth)
      .set('Idempotency-Key', key)
      .send(takeawayOrder())
      .expect(201);

    const retry = await api
      .post('/api/v1/orders')
      .set(auth)
      .set('Idempotency-Key', key)
      .send(takeawayOrder())
      .expect(201);

    expect(retry.body.id).toBe(first.body.id);
    expect(await prisma.order.count()).toBe(1);
  });

  it('claves distintas crean pedidos distintos', async () => {
    await api.post('/api/v1/orders').set(auth).set('Idempotency-Key', 'a').send(takeawayOrder());
    await api.post('/api/v1/orders').set(auth).set('Idempotency-Key', 'b').send(takeawayOrder());
    expect(await prisma.order.count()).toBe(2);
  });
});

describe('máquina de estados', () => {
  async function createOrder(overrides: Record<string, unknown> = {}) {
    const res = await api.post('/api/v1/orders').set(auth).send(takeawayOrder(overrides)).expect(201);
    return res.body;
  }

  it('avanza por las transiciones válidas', async () => {
    const order = await createOrder();

    const confirmed = await api
      .post(`/api/v1/orders/${order.id}/status`)
      .set(auth)
      .send({ from: 'PENDIENTE', to: 'CONFIRMADO' })
      .expect(200);

    expect(confirmed.body.status).toBe('CONFIRMADO');
    expect(confirmed.body.statusHistory).toHaveLength(2);
  });

  it('rechaza un salto inválido', async () => {
    const order = await createOrder();

    const res = await api
      .post(`/api/v1/orders/${order.id}/status`)
      .set(auth)
      .send({ from: 'PENDIENTE', to: 'ENTREGADO' })
      .expect(422);

    expect(res.body.error.details.allowed).toEqual(['CONFIRMADO', 'CANCELADO']);
  });

  it('EN_CAMINO sólo aplica a envíos', async () => {
    const order = await createOrder();
    for (const [from, to] of [
      ['PENDIENTE', 'CONFIRMADO'],
      ['CONFIRMADO', 'EN_PREPARACION'],
      ['EN_PREPARACION', 'LISTO'],
    ]) {
      await api.post(`/api/v1/orders/${order.id}/status`).set(auth).send({ from, to }).expect(200);
    }

    // Un pedido para retirar no puede salir a la calle.
    await api
      .post(`/api/v1/orders/${order.id}/status`)
      .set(auth)
      .send({ from: 'LISTO', to: 'EN_CAMINO' })
      .expect(422);

    await api
      .post(`/api/v1/orders/${order.id}/status`)
      .set(auth)
      .send({ from: 'LISTO', to: 'ENTREGADO' })
      .expect(200);
  });

  it('devuelve 409 si otro usuario ya cambió el estado', async () => {
    const order = await createOrder();

    await api
      .post(`/api/v1/orders/${order.id}/status`)
      .set(auth)
      .send({ from: 'PENDIENTE', to: 'CONFIRMADO' })
      .expect(200);

    // El segundo operador todavía veía "PENDIENTE" en su pantalla.
    const res = await api
      .post(`/api/v1/orders/${order.id}/status`)
      .set(auth)
      .send({ from: 'PENDIENTE', to: 'CANCELADO' })
      .expect(409);

    expect(res.body.error.details.currentStatus).toBe('CONFIRMADO');
  });

  it('cancelar exige motivo y lo guarda', async () => {
    const order = await createOrder();

    await api.post(`/api/v1/orders/${order.id}/cancel`).set(auth).send({}).expect(400);

    const res = await api
      .post(`/api/v1/orders/${order.id}/cancel`)
      .set(auth)
      .send({ reason: 'El cliente se arrepintió' })
      .expect(200);

    expect(res.body.status).toBe('CANCELADO');
    expect(res.body.cancelReason).toBe('El cliente se arrepintió');
  });

  it('un pedido entregado no acepta más cambios', async () => {
    const order = await createOrder();
    for (const [from, to] of [
      ['PENDIENTE', 'CONFIRMADO'],
      ['CONFIRMADO', 'EN_PREPARACION'],
      ['EN_PREPARACION', 'LISTO'],
      ['LISTO', 'ENTREGADO'],
    ]) {
      await api.post(`/api/v1/orders/${order.id}/status`).set(auth).send({ from, to }).expect(200);
    }

    await api
      .post(`/api/v1/orders/${order.id}/cancel`)
      .set(auth)
      .send({ reason: 'tarde' })
      .expect(422);
  });

  it('cancelar descuenta el pedido de los totales del cliente', async () => {
    const customer = await createCustomer({ commerceId: commerce.id, phone: '+59891234567' });
    const order = await createOrder({ customerPhone: '+59891234567' });

    let stats = await prisma.customer.findUnique({ where: { id: customer.id } });
    expect(stats?.ordersCount).toBe(1);

    await api
      .post(`/api/v1/orders/${order.id}/cancel`)
      .set(auth)
      .send({ reason: 'sin stock' })
      .expect(200);

    stats = await prisma.customer.findUnique({ where: { id: customer.id } });
    expect(stats?.ordersCount).toBe(0);
    expect(stats?.totalSpentCents).toBe(0);
  });
});

describe('tablero y listados', () => {
  it('agrupa los pedidos vivos por estado', async () => {
    const a = (await api.post('/api/v1/orders').set(auth).send(takeawayOrder())).body;
    await api.post('/api/v1/orders').set(auth).send(takeawayOrder());

    await api
      .post(`/api/v1/orders/${a.id}/status`)
      .set(auth)
      .send({ from: 'PENDIENTE', to: 'CONFIRMADO' })
      .expect(200);

    const board = await api.get('/api/v1/orders/board').set(auth).expect(200);

    const pendientes = board.body.columns.find((c: { status: string }) => c.status === 'PENDIENTE');
    const confirmados = board.body.columns.find((c: { status: string }) => c.status === 'CONFIRMADO');

    expect(pendientes.orders).toHaveLength(1);
    expect(confirmados.orders).toHaveLength(1);
  });

  it('filtra el historial por estado', async () => {
    const a = (await api.post('/api/v1/orders').set(auth).send(takeawayOrder())).body;
    await api.post('/api/v1/orders').set(auth).send(takeawayOrder());
    await api
      .post(`/api/v1/orders/${a.id}/cancel`)
      .set(auth)
      .send({ reason: 'prueba' })
      .expect(200);

    const res = await api.get('/api/v1/orders?status=CANCELADO').set(auth).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(a.id);
  });
});

describe('dashboard', () => {
  it('no cuenta los pedidos cancelados en las ventas', async () => {
    await api.post('/api/v1/orders').set(auth).send(takeawayOrder());
    const cancelled = (await api.post('/api/v1/orders').set(auth).send(takeawayOrder())).body;
    await api.post(`/api/v1/orders/${cancelled.id}/cancel`).set(auth).send({ reason: 'x' });

    const res = await api.get('/api/v1/reports/dashboard').set(auth).expect(200);

    expect(res.body.ordersCount).toBe(1);
    expect(res.body.salesCents).toBe(1_450_000);
    expect(res.body.averageTicketCents).toBe(1_450_000);
  });

  it('lista los productos más vendidos', async () => {
    await api
      .post('/api/v1/orders')
      .set(auth)
      .send(takeawayOrder({ items: [{ variantId: catalog.pizzaGrande.publicId, quantity: 3 }] }));
    await api
      .post('/api/v1/orders')
      .set(auth)
      .send(takeawayOrder({ items: [{ variantId: catalog.drinkVariant.publicId, quantity: 1 }] }));

    const res = await api.get('/api/v1/reports/dashboard').set(auth).expect(200);

    expect(res.body.topProducts[0].name).toBe('Muzzarella');
    expect(res.body.topProducts[0].quantity).toBe(3);
  });

  it('con la base vacía devuelve ceros y no rompe', async () => {
    const res = await api.get('/api/v1/reports/dashboard').set(auth).expect(200);
    expect(res.body.ordersCount).toBe(0);
    expect(res.body.averageTicketCents).toBe(0);
  });
});

describe('aislamiento de pedidos entre comercios', () => {
  it('un comercio no ve ni toca los pedidos de otro', async () => {
    const order = (await api.post('/api/v1/orders').set(auth).send(takeawayOrder())).body;

    const otherCommerce = await createCommerce('Otra pizzería');
    const otherUser = await createUser({ commerceId: otherCommerce.id, role: 'OWNER' });
    const otherAuth = await authHeader(otherUser);

    const list = await api.get('/api/v1/orders').set(otherAuth).expect(200);
    expect(list.body.data).toHaveLength(0);

    await api.get(`/api/v1/orders/${order.id}`).set(otherAuth).expect(404);

    await api
      .post(`/api/v1/orders/${order.id}/status`)
      .set(otherAuth)
      .send({ from: 'PENDIENTE', to: 'CANCELADO' })
      .expect(404);

    const dashboard = await api.get('/api/v1/reports/dashboard').set(otherAuth).expect(200);
    expect(dashboard.body.salesCents).toBe(0);
  });

  it('no se puede pedir una variante de otro comercio', async () => {
    const otherCommerce = await createCommerce('Otra pizzería');
    const otherUser = await createUser({ commerceId: otherCommerce.id, role: 'OWNER' });
    const otherCatalog = await createCatalog(otherCommerce.id);

    // El catálogo ajeno no existe para este comercio, aunque el id sea válido.
    const res = await api
      .post('/api/v1/orders')
      .set(auth)
      .send(takeawayOrder({ items: [{ variantId: otherCatalog.pizzaGrande.publicId, quantity: 1 }] }))
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(otherUser.commerceId).toBe(otherCommerce.id);
  });
});
