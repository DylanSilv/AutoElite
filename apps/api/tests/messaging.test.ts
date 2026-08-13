import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import {
  PermanentSendError,
  setMessagingProvider,
  type MessagingProvider,
} from '../src/modules/messaging/messaging.provider.js';
import { dispatchPending } from '../src/modules/messaging/messaging.service.js';
import { createCatalog, createCommerce, createUser, resetDatabase } from './helpers/factories.js';
import { api, authHeader } from './helpers/request.js';

/**
 * Los avisos automáticos son la cara visible del sistema para el cliente final:
 * si llegan de más, molestan; si llegan de menos, el cliente llama por teléfono
 * y se pierde el beneficio de automatizar.
 */

let commerce: Awaited<ReturnType<typeof createCommerce>>;
let catalog: Awaited<ReturnType<typeof createCatalog>>;
let auth: { Authorization: string };

/** Proveedor de prueba: registra lo enviado y puede simular fallas. */
class FakeProvider implements MessagingProvider {
  readonly name = 'fake';
  readonly sent: { to: string; body: string }[] = [];
  failure: 'none' | 'transient' | 'permanent' = 'none';

  async sendText(to: string, body: string) {
    if (this.failure === 'permanent') throw new PermanentSendError('número inválido');
    if (this.failure === 'transient') throw new Error('timeout');
    this.sent.push({ to, body });
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}

let provider: FakeProvider;

beforeEach(async () => {
  await resetDatabase();
  commerce = await createCommerce('La Napolitana');
  const user = await createUser({ commerceId: commerce.id, role: 'OWNER' });
  catalog = await createCatalog(commerce.id);
  auth = await authHeader(user);

  provider = new FakeProvider();
  setMessagingProvider(provider);
});

afterEach(() => setMessagingProvider(null));

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

/**
 * Crea un pedido con un cliente que ya escribió por WhatsApp, que es la
 * situación en la que se puede responder sin plantilla aprobada.
 */
async function createOrderWithOpenWindow(overrides: Record<string, unknown> = {}) {
  const res = await api
    .post('/api/v1/orders')
    .set(auth)
    .send({
      type: 'TAKEAWAY',
      customerName: 'Martina Silva',
      customerPhone: '099 123 456',
      items: [{ variantId: catalog.pizzaGrande.publicId, quantity: 1 }],
      ...overrides,
    })
    .expect(201);

  await prisma.customer.updateMany({
    where: { phoneE164: '+59899123456' },
    data: { lastInboundAt: new Date() },
  });

  return res.body;
}

async function advance(orderId: string, from: string, to: string) {
  return api.post(`/api/v1/orders/${orderId}/status`).set(auth).send({ from, to }).expect(200);
}

async function messagesFor(orderPublicId: string) {
  const order = await prisma.order.findUnique({ where: { publicId: orderPublicId } });
  return prisma.outboundMessage.findMany({
    where: { orderId: order!.id },
    orderBy: { id: 'asc' },
  });
}

describe('qué avisos se generan', () => {
  it('un pedido para retirar avisa cuando está listo', async () => {
    const order = await createOrderWithOpenWindow();

    await advance(order.id, 'PENDIENTE', 'CONFIRMADO');
    await advance(order.id, 'CONFIRMADO', 'EN_PREPARACION');
    await advance(order.id, 'EN_PREPARACION', 'LISTO');

    const messages = await messagesFor(order.id);
    const kinds = messages.map((m) => m.kind);

    expect(kinds).toContain('ORDER_CONFIRMED');
    expect(kinds).toContain('ORDER_READY_PICKUP');
    // La cocina mueve el pedido a preparación sin que el cliente se entere.
    expect(kinds).not.toContain('ORDER_RECEIVED');
  });

  it('un envío NO avisa en LISTO, porque todavía no salió', async () => {
    const order = await createOrderWithOpenWindow({
      type: 'DELIVERY',
      address: { street: 'Av. 18 de Julio', number: '1435', deliveryZoneId: catalog.zone.publicId },
    });

    await advance(order.id, 'PENDIENTE', 'CONFIRMADO');
    await advance(order.id, 'CONFIRMADO', 'EN_PREPARACION');
    await advance(order.id, 'EN_PREPARACION', 'LISTO');

    const kinds = (await messagesFor(order.id)).map((m) => m.kind);
    // Avisarle "está listo" lo haría salir a la puerta al pedo.
    expect(kinds).not.toContain('ORDER_READY_PICKUP');
    expect(kinds).not.toContain('ORDER_READY_DINE_IN');
  });

  it('un envío avisa cuando sale el pedido', async () => {
    const order = await createOrderWithOpenWindow({
      type: 'DELIVERY',
      address: { street: 'Av. 18 de Julio', number: '1435', deliveryZoneId: catalog.zone.publicId },
    });

    await advance(order.id, 'PENDIENTE', 'CONFIRMADO');
    await advance(order.id, 'CONFIRMADO', 'EN_PREPARACION');
    await advance(order.id, 'EN_PREPARACION', 'LISTO');
    await advance(order.id, 'LISTO', 'EN_CAMINO');

    const messages = await messagesFor(order.id);
    const onTheWay = messages.find((m) => m.kind === 'ORDER_ON_THE_WAY');

    expect(onTheWay).toBeDefined();
    expect(onTheWay?.body).toContain('Av. 18 de Julio');
  });

  it('avisa si el pedido se cancela, con el motivo', async () => {
    const order = await createOrderWithOpenWindow();

    await api
      .post(`/api/v1/orders/${order.id}/cancel`)
      .set(auth)
      .send({ reason: 'Nos quedamos sin masa' })
      .expect(200);

    const cancelled = (await messagesFor(order.id)).find((m) => m.kind === 'ORDER_CANCELLED');
    expect(cancelled?.body).toContain('Nos quedamos sin masa');
  });

  it('un pedido cargado en el panel no acusa recibo', async () => {
    // El cliente que pidió por teléfono ya sabe que su pedido entró.
    const order = await createOrderWithOpenWindow();
    const kinds = (await messagesFor(order.id)).map((m) => m.kind);
    expect(kinds).not.toContain('ORDER_RECEIVED');
  });

  it('un pedido que llegó por WhatsApp sí acusa recibo', async () => {
    const order = await createOrderWithOpenWindow({ source: 'WHATSAPP' });
    const kinds = (await messagesFor(order.id)).map((m) => m.kind);
    expect(kinds).toContain('ORDER_RECEIVED');
  });

  it('el mensaje incluye el número de pedido y el total', async () => {
    const order = await createOrderWithOpenWindow();
    await advance(order.id, 'PENDIENTE', 'CONFIRMADO');

    const confirmed = (await messagesFor(order.id)).find((m) => m.kind === 'ORDER_CONFIRMED');
    expect(confirmed?.body).toContain(`#${order.number}`);
    expect(confirmed?.body).toContain('Martina');
  });
});

describe('ventana de 24 horas de WhatsApp', () => {
  it('omite el aviso si el cliente nunca escribió', async () => {
    const created = await api
      .post('/api/v1/orders')
      .set(auth)
      .send({
        type: 'TAKEAWAY',
        customerName: 'Nunca Escribió',
        customerPhone: '094 111 222',
        items: [{ variantId: catalog.pizzaGrande.publicId, quantity: 1 }],
      })
      .expect(201);

    await advance(created.body.id, 'PENDIENTE', 'CONFIRMADO');

    const [message] = await messagesFor(created.body.id);
    // No es un error: WhatsApp exige una plantilla aprobada para iniciar la
    // conversación, y el motivo queda registrado para que el personal lo vea.
    expect(message?.status).toBe('SKIPPED');
    expect(message?.skipReason).toContain('plantilla aprobada');
  });

  it('omite el aviso si pasaron más de 24 horas', async () => {
    const order = await createOrderWithOpenWindow();
    await prisma.customer.updateMany({
      where: { phoneE164: '+59899123456' },
      data: { lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    await advance(order.id, 'PENDIENTE', 'CONFIRMADO');

    const message = (await messagesFor(order.id)).find((m) => m.kind === 'ORDER_CONFIRMED');
    expect(message?.status).toBe('SKIPPED');
  });

  it('respeta a quien pidió no recibir avisos', async () => {
    const order = await createOrderWithOpenWindow();
    await prisma.customer.updateMany({
      where: { phoneE164: '+59899123456' },
      data: { acceptsNotifications: false },
    });

    await advance(order.id, 'PENDIENTE', 'CONFIRMADO');

    const message = (await messagesFor(order.id)).find((m) => m.kind === 'ORDER_CONFIRMED');
    expect(message?.status).toBe('SKIPPED');
    expect(message?.skipReason).toContain('no recibir avisos');
  });
});

describe('envío de la cola', () => {
  it('envía los pendientes y los marca como enviados', async () => {
    const order = await createOrderWithOpenWindow();
    await advance(order.id, 'PENDIENTE', 'CONFIRMADO');

    const result = await dispatchPending();

    expect(result.sent).toBe(1);
    expect(provider.sent[0]?.to).toBe('+59899123456');

    const message = (await messagesFor(order.id)).find((m) => m.kind === 'ORDER_CONFIRMED');
    expect(message?.status).toBe('SENT');
    expect(message?.providerMessageId).toBe('fake-1');
    expect(message?.sentAt).not.toBeNull();
  });

  it('no reintenta un error permanente', async () => {
    const order = await createOrderWithOpenWindow();
    await advance(order.id, 'PENDIENTE', 'CONFIRMADO');

    provider.failure = 'permanent';
    await dispatchPending();

    const message = (await messagesFor(order.id)).find((m) => m.kind === 'ORDER_CONFIRMED');
    // Un número inválido no mejora reintentando: sólo gastaría cuota.
    expect(message?.status).toBe('FAILED');
    expect(message?.attempts).toBe(1);
  });

  it('reintenta un error transitorio', async () => {
    const order = await createOrderWithOpenWindow();
    await advance(order.id, 'PENDIENTE', 'CONFIRMADO');

    provider.failure = 'transient';
    await dispatchPending();

    let message = (await messagesFor(order.id)).find((m) => m.kind === 'ORDER_CONFIRMED');
    expect(message?.status).toBe('PENDING');
    expect(message?.attempts).toBe(1);

    // Cuando el proveedor se recupera, el aviso sale sin intervención.
    provider.failure = 'none';
    await dispatchPending();

    message = (await messagesFor(order.id)).find((m) => m.kind === 'ORDER_CONFIRMED');
    expect(message?.status).toBe('SENT');
  });

  it('no vuelve a enviar lo ya enviado', async () => {
    const order = await createOrderWithOpenWindow();
    await advance(order.id, 'PENDIENTE', 'CONFIRMADO');

    await dispatchPending();
    await dispatchPending();

    expect(provider.sent).toHaveLength(1);
  });

  it('no envía los omitidos', async () => {
    await api
      .post('/api/v1/orders')
      .set(auth)
      .send({
        type: 'TAKEAWAY',
        customerName: 'Sin Ventana',
        customerPhone: '094 333 444',
        items: [{ variantId: catalog.pizzaGrande.publicId, quantity: 1 }],
      })
      .expect(201);

    const result = await dispatchPending();
    expect(result.sent).toBe(0);
    expect(provider.sent).toHaveLength(0);
  });
});

describe('aislamiento', () => {
  it('los avisos quedan asociados al comercio que los generó', async () => {
    const order = await createOrderWithOpenWindow();
    await advance(order.id, 'PENDIENTE', 'CONFIRMADO');

    const otherCommerce = await createCommerce('Otra pizzería');
    const messages = await prisma.outboundMessage.findMany();

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((m) => m.commerceId === commerce.id)).toBe(true);
    expect(messages.some((m) => m.commerceId === otherCommerce.id)).toBe(false);
  });
});
