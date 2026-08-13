import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { setMessagingProvider } from '../src/modules/messaging/messaging.provider.js';
import {
  createApiClient,
  createCatalog,
  createCommerce,
  createUser,
  resetDatabase,
} from './helpers/factories.js';
import { api, apiKeyHeader, authHeader } from './helpers/request.js';

/**
 * Cobro previo.
 *
 * La regla: un pedido que llega por WhatsApp y se paga por transferencia o
 * Mercado Pago no puede llegar a la cocina hasta que alguien verifique el pago.
 * Sin eso, un pedido de alguien que nunca aparece deja la comida hecha y
 * perdida.
 */

let commerce: Awaited<ReturnType<typeof createCommerce>>;
let catalog: Awaited<ReturnType<typeof createCatalog>>;
let auth: { Authorization: string };
let transferMethod: { publicId: string; id: number };

beforeEach(async () => {
  await resetDatabase();
  commerce = await createCommerce('La Napolitana');
  const user = await createUser({ commerceId: commerce.id, role: 'OWNER' });
  catalog = await createCatalog(commerce.id);
  auth = await authHeader(user);
  setMessagingProvider(null);

  transferMethod = await prisma.paymentMethod.create({
    data: {
      commerceId: commerce.id,
      name: 'Transferencia',
      code: 'TRANSFER',
      requiresPrepayment: true,
      instructions: 'Alias: lanapolitana.mvd · Titular: La Napolitana SRL',
    },
  });

  // El efectivo se limita al local: cobrar efectivo en un envío implica que el
  // cadete maneje plata y vuelto.
  await prisma.paymentMethod.update({
    where: { id: catalog.paymentMethod.id },
    data: { allowedOrderTypes: ['DINE_IN', 'TAKEAWAY'] },
  });
});

afterEach(() => setMessagingProvider(null));

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

async function createWhatsAppOrder(overrides: Record<string, unknown> = {}) {
  const res = await api
    .post('/api/v1/orders')
    .set(auth)
    .send({
      type: 'TAKEAWAY',
      source: 'WHATSAPP',
      customerName: 'Martina Silva',
      customerPhone: '099 123 456',
      paymentMethodId: transferMethod.publicId,
      items: [{ variantId: catalog.pizzaGrande.publicId, quantity: 1 }],
      ...overrides,
    })
    .expect(201);
  return res.body;
}

describe('cuándo se exige pago previo', () => {
  it('un pedido por WhatsApp con transferencia queda esperando pago', async () => {
    const order = await createWhatsAppOrder();
    expect(order.paymentStatus).toBe('PENDING');
    expect(order.status).toBe('PENDIENTE');
  });

  it('el mismo pedido cargado en el panel no exige pago previo', async () => {
    // El personal está mirando al cliente: frenarlo no aporta nada.
    const order = await createWhatsAppOrder({ source: 'PANEL' });
    expect(order.paymentStatus).toBe('NOT_REQUIRED');
  });

  it('un método sin prepago no bloquea aunque venga por WhatsApp', async () => {
    const order = await createWhatsAppOrder({
      paymentMethodId: catalog.paymentMethod.publicId,
      type: 'TAKEAWAY',
    });
    expect(order.paymentStatus).toBe('NOT_REQUIRED');
  });

  it('el efectivo no se puede usar en un envío', async () => {
    const res = await api
      .post('/api/v1/orders')
      .set(auth)
      .send({
        type: 'DELIVERY',
        source: 'WHATSAPP',
        customerName: 'Martina Silva',
        customerPhone: '099 123 456',
        paymentMethodId: catalog.paymentMethod.publicId,
        address: { street: 'Av. 18 de Julio', number: '1435' },
        items: [{ variantId: catalog.pizzaGrande.publicId, quantity: 1 }],
      })
      .expect(422);

    expect(res.body.error.message).toContain('no está disponible para esta modalidad');
  });
});

describe('el pedido impago no llega a la cocina', () => {
  it('no se puede confirmar sin pago verificado', async () => {
    const order = await createWhatsAppOrder();

    const res = await api
      .post(`/api/v1/orders/${order.id}/status`)
      .set(auth)
      .send({ from: 'PENDIENTE', to: 'CONFIRMADO' })
      .expect(422);

    expect(res.body.error.message).toContain('todavía no está pago');
  });

  it('sí se puede cancelar: un pedido que nunca se pagó tiene que poder descartarse', async () => {
    const order = await createWhatsAppOrder();

    await api
      .post(`/api/v1/orders/${order.id}/cancel`)
      .set(auth)
      .send({ reason: 'El cliente no pagó' })
      .expect(200);
  });

  it('no aparece entre los pendientes del tablero', async () => {
    const order = await createWhatsAppOrder();

    const board = await api.get('/api/v1/orders/board').set(auth).expect(200);
    const pendientes = board.body.columns.find((c: { status: string }) => c.status === 'PENDIENTE');

    // Está aparte, no mezclado con los pendientes de preparar: si estuviera ahí,
    // alguien lo tomaría por error.
    expect(pendientes.orders).toHaveLength(0);
    expect(board.body.awaitingPayment).toHaveLength(1);
    expect(board.body.awaitingPayment[0].id).toBe(order.id);
  });

  it('avanza normalmente una vez confirmado el pago', async () => {
    const order = await createWhatsAppOrder();

    await api.post(`/api/v1/orders/${order.id}/payment/confirm`).set(auth).send({}).expect(200);

    const advanced = await api
      .post(`/api/v1/orders/${order.id}/status`)
      .set(auth)
      .send({ from: 'PENDIENTE', to: 'CONFIRMADO' })
      .expect(200);

    expect(advanced.body.status).toBe('CONFIRMADO');

    const board = await api.get('/api/v1/orders/board').set(auth).expect(200);
    expect(board.body.awaitingPayment).toHaveLength(0);
  });
});

describe('comprobante', () => {
  it('registrarlo deja el pedido a la espera de verificación', async () => {
    const order = await createWhatsAppOrder();

    const res = await api
      .post(`/api/v1/orders/${order.id}/payment/proof`)
      .set(auth)
      .send({ mediaUrl: 'https://ejemplo.test/comprobante.jpg', note: 'Transferí recién' })
      .expect(200);

    expect(res.body.paymentStatus).toBe('PROOF_SUBMITTED');
    expect(res.body.paymentProofs).toHaveLength(1);
    expect(res.body.paymentProofs[0].note).toBe('Transferí recién');
  });

  it('un comprobante NO alcanza para avanzar por sí solo', async () => {
    // El punto central del diseño: una captura se falsifica en minutos, así que
    // sirve para que una persona verifique, no para confirmar sola.
    const order = await createWhatsAppOrder();

    await api
      .post(`/api/v1/orders/${order.id}/payment/proof`)
      .set(auth)
      .send({ mediaUrl: 'https://ejemplo.test/falso.jpg' })
      .expect(200);

    await api
      .post(`/api/v1/orders/${order.id}/status`)
      .set(auth)
      .send({ from: 'PENDIENTE', to: 'CONFIRMADO' })
      .expect(422);
  });

  it('exige una imagen', async () => {
    const order = await createWhatsAppOrder();
    await api
      .post(`/api/v1/orders/${order.id}/payment/proof`)
      .set(auth)
      .send({ note: 'ya pagué' })
      .expect(400);
  });

  it('se puede reenviar tras un rechazo', async () => {
    const order = await createWhatsAppOrder();

    await api
      .post(`/api/v1/orders/${order.id}/payment/reject`)
      .set(auth)
      .send({ note: 'El comprobante es de otro monto' })
      .expect(200);

    const res = await api
      .post(`/api/v1/orders/${order.id}/payment/proof`)
      .set(auth)
      .send({ mediaUrl: 'https://ejemplo.test/segundo-intento.jpg' })
      .expect(200);

    expect(res.body.paymentStatus).toBe('PROOF_SUBMITTED');
  });
});

describe('quién puede confirmar un pago', () => {
  it('una API key no puede: hace falta que una persona mire la cuenta', async () => {
    const order = await createWhatsAppOrder();
    const { key } = await createApiClient({ commerceId: commerce.id });

    const res = await api
      .post(`/api/v1/orders/${order.id}/payment/confirm`)
      .set(apiKeyHeader(key))
      .send({})
      .expect(403);

    expect(res.body.error.message).toContain('requiere una persona');
  });

  it('el agente sí puede registrar el comprobante', async () => {
    const order = await createWhatsAppOrder();
    const { key } = await createApiClient({ commerceId: commerce.id });

    const res = await api
      .post(`/api/v1/orders/${order.id}/payment/proof`)
      .set(apiKeyHeader(key))
      .send({ whatsappMediaId: 'wamid.abc123', mimeType: 'image/jpeg' })
      .expect(200);

    expect(res.body.paymentStatus).toBe('PROOF_SUBMITTED');
  });

  it('confirmar marca el pedido como pagado y registra quién lo hizo', async () => {
    const order = await createWhatsAppOrder();

    const res = await api
      .post(`/api/v1/orders/${order.id}/payment/confirm`)
      .set(auth)
      .send({ note: 'Verificado en la cuenta' })
      .expect(200);

    expect(res.body.paymentStatus).toBe('CONFIRMED');
    expect(res.body.isPaid).toBe(true);
    expect(res.body.paidAt).not.toBeNull();

    const stored = await prisma.order.findUnique({ where: { publicId: order.id } });
    expect(stored?.paymentReviewedByUserId).not.toBeNull();
  });
});

describe('avisos de cobro', () => {
  it('al crear el pedido se le mandan las instrucciones, no un acuse de recibo', async () => {
    await prisma.customer.updateMany({ data: { lastInboundAt: new Date() } });
    const order = await createWhatsAppOrder();

    const stored = await prisma.order.findUnique({ where: { publicId: order.id } });
    const messages = await prisma.outboundMessage.findMany({ where: { orderId: stored!.id } });

    const requested = messages.find((m) => m.kind === 'PAYMENT_REQUESTED');
    expect(requested).toBeDefined();
    // Sin esto el cliente queda esperando sin saber que la pelota está de su lado.
    expect(requested?.body).toContain('lanapolitana.mvd');
    expect(requested?.body).toContain('comprobante');
    expect(messages.some((m) => m.kind === 'ORDER_RECEIVED')).toBe(false);
  });

  it('confirmar el pago avisa al cliente', async () => {
    const order = await createWhatsAppOrder();
    await prisma.customer.updateMany({ data: { lastInboundAt: new Date() } });

    await api.post(`/api/v1/orders/${order.id}/payment/confirm`).set(auth).send({}).expect(200);

    const stored = await prisma.order.findUnique({ where: { publicId: order.id } });
    const messages = await prisma.outboundMessage.findMany({ where: { orderId: stored!.id } });
    expect(messages.some((m) => m.kind === 'PAYMENT_CONFIRMED')).toBe(true);
  });

  it('rechazar el pago le pide al cliente que reenvíe', async () => {
    const order = await createWhatsAppOrder();
    await prisma.customer.updateMany({ data: { lastInboundAt: new Date() } });

    await api
      .post(`/api/v1/orders/${order.id}/payment/reject`)
      .set(auth)
      .send({ note: 'El monto no coincide' })
      .expect(200);

    const stored = await prisma.order.findUnique({ where: { publicId: order.id } });
    const messages = await prisma.outboundMessage.findMany({ where: { orderId: stored!.id } });
    const rejected = messages.find((m) => m.kind === 'PAYMENT_REJECTED');

    expect(rejected?.body).toContain('El monto no coincide');
  });

  it('rechazar exige explicar por qué', async () => {
    const order = await createWhatsAppOrder();
    await api
      .post(`/api/v1/orders/${order.id}/payment/reject`)
      .set(auth)
      .send({})
      .expect(400);
  });
});
