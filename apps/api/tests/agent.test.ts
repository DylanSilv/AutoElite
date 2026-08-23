import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { buildAgentContext } from '../src/modules/agent/agent.context.js';
import { handleInboundMessage } from '../src/modules/agent/agent.service.js';
import { setLlmProvider } from '../src/modules/agent/llm.factory.js';
import type { TenantContext } from '../src/http/context.js';
import { createCatalog, createCommerce, resetDatabase } from './helpers/factories.js';

/**
 * El asistente de WhatsApp, de punta a punta.
 *
 * Se prueba con el proveedor por reglas, que es determinista: acá interesa que
 * el runtime, las herramientas y las reglas de negocio hagan lo que tienen que
 * hacer, no cómo redacta un modelo.
 */

const PHONE = '099 123 456';

let ctx: TenantContext;
let catalog: Awaited<ReturnType<typeof createCatalog>>;

beforeEach(async () => {
  await resetDatabase();
  setLlmProvider(null);

  const commerce = await createCommerce('La Napolitana');
  catalog = await createCatalog(commerce.id);

  await prisma.paymentMethod.update({
    where: { id: catalog.paymentMethod.id },
    data: { allowedOrderTypes: ['DINE_IN', 'TAKEAWAY'] },
  });
  await prisma.paymentMethod.create({
    data: {
      commerceId: commerce.id,
      name: 'Transferencia',
      code: 'TRANSFER',
      requiresPrepayment: true,
      instructions: 'Alias: lanapolitana.mvd',
    },
  });

  const built = await buildAgentContext(commerce.id);
  if (!built) throw new Error('No se pudo construir el contexto del asistente');
  ctx = built;
});

afterAll(async () => {
  await resetDatabase();
  await prisma.$disconnect();
});

/** Manda un mensaje como si lo escribiera el cliente y devuelve la respuesta. */
async function escribir(text: string, extra: Record<string, unknown> = {}) {
  return handleInboundMessage(ctx, {
    phone: PHONE,
    text,
    channel: 'WHATSAPP',
    ...extra,
  } as Parameters<typeof handleInboundMessage>[1]);
}

describe('consultas', () => {
  it('responde la carta con precios de la base', async () => {
    const res = await escribir('hola, me pasás la carta?');

    expect(res.toolsUsed).toContain('ver_menu');
    expect(res.reply).toContain('Muzzarella');
    // El precio sale del catálogo, no de una plantilla escrita a mano.
    expect(res.reply).toContain('8.500');
  });

  it('cuenta las promociones vigentes', async () => {
    await prisma.promotion.create({
      data: {
        commerceId: ctx.commerceId,
        title: 'Martes de muzza',
        description: '2x1 en muzzarella grande',
      },
    });

    const res = await escribir('tenés alguna promo?');
    expect(res.toolsUsed).toContain('ver_promociones');
    expect(res.reply).toContain('Martes de muzza');
  });

  it('no inventa promociones cuando no hay', async () => {
    const res = await escribir('hay descuentos hoy?');
    expect(res.reply).toContain('no tenemos promos');
  });

  it('informa el horario que cargó el comercio', async () => {
    await prisma.commerce.update({
      where: { id: ctx.commerceId },
      data: { openingHours: 'todos los días desde las 19:00' },
    });
    const built = await buildAgentContext(ctx.commerceId);
    const res = await handleInboundMessage(built!, {
      phone: PHONE,
      text: '¿a qué hora abren?',
      channel: 'WHATSAPP',
    } as Parameters<typeof handleInboundMessage>[1]);

    expect(res.toolsUsed).toContain('ver_horario');
    expect(res.reply).toContain('19:00');
  });

  it('sin horario cargado, deriva en vez de inventar uno', async () => {
    // Mandar a alguien a un local cerrado es peor que no contestar.
    const res = await escribir('están abiertos?');
    expect(res.reply).toContain('No tengo el horario');
  });

  it('informa las zonas de reparto con su costo', async () => {
    const res = await escribir('llegan a mi barrio? cuánto sale el envío');
    expect(res.toolsUsed).toContain('ver_zonas_de_envio');
    expect(res.reply).toContain(catalog.zone.name);
  });
});

describe('armado del pedido', () => {
  it('reconoce lo que pide el cliente y arma el total', async () => {
    const res = await escribir('quiero 2 muzzarella grande');

    expect(res.toolsUsed).toContain('armar_pedido');
    expect(res.reply).toContain('2x');
    expect(res.reply).toContain('Muzzarella');

    const conversation = await prisma.conversation.findFirst();
    const draft = conversation?.draft as { items: { quantity: number }[] };
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]?.quantity).toBe(2);
  });

  it('entiende apodos y errores de tipeo', async () => {
    const res = await escribir('una muza grande porfa');
    expect(res.reply).toContain('Muzzarella');
  });

  it('avisa cuando algo no está en la carta en vez de suponer', async () => {
    const res = await escribir('quiero una pizza de ananá');
    expect(res.reply).toContain('No encontré');
  });

  it('pide los datos que faltan de a uno', async () => {
    const primera = await escribir('una muzzarella grande');
    expect(primera.reply).toContain('envío');

    const segunda = await escribir('para retirar');
    expect(segunda.reply).toContain('pagar');
  });

  it('recuerda el pedido entre mensajes', async () => {
    await escribir('una muzzarella grande');
    await escribir('para retirar');
    const res = await escribir('efectivo');

    // Con todo completo, corresponde pedir la confirmación.
    expect(res.reply).toContain('¿Confirmo el pedido?');
  });
});

describe('confirmación y cobro previo', () => {
  async function armarPedidoCompleto(medio: string) {
    await escribir('una muzzarella grande');
    await escribir('para retirar');
    await escribir(medio);
  }

  it('crea el pedido recién cuando el cliente confirma', async () => {
    await armarPedidoCompleto('efectivo');
    expect(await prisma.order.count()).toBe(0);
    const res = await escribir('si dale');

    expect(res.toolsUsed).toContain('confirmar_pedido');
    const order = await prisma.order.findFirst();
    expect(order).not.toBeNull();
    expect(order?.source).toBe('WHATSAPP');
    expect(res.reply).toContain(`#${order?.number}`);
  });

  it('con un medio que exige prepago, manda las instrucciones y no entra a la cocina', async () => {
    await armarPedidoCompleto('transferencia');
    const res = await escribir('confirmo');

    const order = await prisma.order.findFirst();
    expect(order?.paymentStatus).toBe('PENDING');
    expect(res.reply).toContain('lanapolitana.mvd');
    expect(res.reply).toContain('comprobante');
  });

  it('no deja pagar en efectivo un envío', async () => {
    await escribir('una muzzarella grande');
    await escribir('es para envío');
    await escribir('Av. 18 de Julio 1580');
    await escribir(catalog.zone.name);
    const res = await escribir('efectivo');

    expect(res.reply).toContain('no está disponible para esta modalidad');
    expect(await prisma.order.count()).toBe(0);
  });

  it('el precio sale del catálogo, no de lo que diga el cliente', async () => {
    await escribir('una muzzarella grande, te la pago 10 pesos');
    await escribir('para retirar');
    await escribir('efectivo');
    await escribir('si');

    const order = await prisma.order.findFirst();
    expect(order?.totalCents).toBe(catalog.pizzaGrande.priceCents);
  });
});

describe('envíos', () => {
  it('toma la dirección, cobra el envío de la zona y lo guarda en el pedido', async () => {
    await escribir('una muzzarella grande');
    await escribir('para envío');
    const direccion = await escribir('Av. 18 de Julio 1580, apto 502');

    // La calle no dice a qué zona pertenece: sin preguntar el barrio, el envío
    // se cobraría $0 y la diferencia la pondría el comercio.
    expect(direccion.reply).toContain('barrio');

    await escribir(catalog.zone.name);
    await escribir('transferencia');
    await escribir('dale');

    const order = await prisma.order.findFirst();
    expect(order?.type).toBe('DELIVERY');
    expect(order?.deliveryStreet).toContain('18 de Julio');
    expect(order?.deliveryNumber).toBe('1580');
    expect(order?.deliveryZoneName).toBe(catalog.zone.name);
    expect(order?.deliveryFeeCents).toBe(catalog.zone.feeCents);
    expect(order?.totalCents).toBe(catalog.pizzaGrande.priceCents + catalog.zone.feeCents);
  });

  it('no promete un envío a un barrio al que no se reparte', async () => {
    await escribir('una muzzarella grande');
    await escribir('para envío');
    await escribir('Ruta 8 km 40');
    const res = await escribir('Barros Blancos');

    expect(res.reply).toContain('No estamos repartiendo');
    expect(res.reply).toContain(catalog.zone.name);
  });
});

describe('comprobante de pago', () => {
  it('registra la imagen contra el pedido que espera pago', async () => {
    await escribir('una muzzarella grande');
    await escribir('para retirar');
    await escribir('transferencia');
    await escribir('si');

    const res = await escribir('ya te transferí', {
      mediaId: 'wamid.imagen123',
      mediaType: 'image/jpeg',
    });

    expect(res.toolsUsed).toContain('registrar_comprobante');

    const order = await prisma.order.findFirst();
    // Sigue sin estar pago: una captura la verifica una persona.
    expect(order?.paymentStatus).toBe('PROOF_SUBMITTED');
    expect(order?.isPaid).toBe(false);

    const proof = await prisma.paymentProof.findFirst();
    expect(proof?.whatsappMediaId).toBe('wamid.imagen123');
  });

  it('sin imagen, pide la captura en vez de dar por pago', async () => {
    await escribir('una muzzarella grande');
    await escribir('para retirar');
    await escribir('transferencia');
    await escribir('si');

    const res = await escribir('ya pagué');

    const order = await prisma.order.findFirst();
    expect(order?.paymentStatus).toBe('PENDING');
    expect(res.reply).toContain('captura');
  });
});

describe('seguimiento', () => {
  it('informa el estado del último pedido', async () => {
    await escribir('una muzzarella grande');
    await escribir('para retirar');
    await escribir('efectivo');
    await escribir('si');

    const res = await escribir('cómo viene mi pedido?');
    expect(res.toolsUsed).toContain('consultar_pedido');
    expect(res.reply).toContain('#');
  });

  it('no inventa un pedido que no existe', async () => {
    const res = await escribir('dónde está mi pedido?');
    expect(res.reply).toContain('No encontré ningún pedido');
  });
});

describe('derivación a una persona', () => {
  it('deriva ante un reclamo y deja de responder', async () => {
    const res = await escribir('quiero hablar con el encargado, tengo un reclamo');

    expect(res.toolsUsed).toContain('derivar_a_persona');

    const conversation = await prisma.conversation.findFirst();
    expect(conversation?.status).toBe('HUMAN');
    expect(conversation?.handoffReason).not.toBeNull();

    // Con la conversación en manos de una persona, el asistente se calla: dos
    // voces contestándole al mismo cliente es peor que una sola tardía.
    const siguiente = await escribir('hola?');
    expect(siguiente.reply).toBeNull();
  });

  it('una cancelación también la mira una persona', async () => {
    await escribir('quiero cancelar el pedido');
    const conversation = await prisma.conversation.findFirst();
    expect(conversation?.status).toBe('HUMAN');
  });
});

describe('el canal', () => {
  it('deja la respuesta en la cola de salida de WhatsApp', async () => {
    await escribir('hola');
    const outbound = await prisma.outboundMessage.findMany({ where: { kind: 'AGENT_REPLY' } });
    expect(outbound).toHaveLength(1);
    expect(outbound[0]?.toPhoneE164).toBe('+59899123456');
  });

  it('el simulador no le manda nada a nadie', async () => {
    await handleInboundMessage(ctx, {
      phone: PHONE,
      text: 'hola',
      channel: 'SIMULATOR',
    } as Parameters<typeof handleInboundMessage>[1]);

    expect(await prisma.outboundMessage.count()).toBe(0);
    const conversation = await prisma.conversation.findFirst({ where: { channel: 'SIMULATOR' } });
    expect(conversation).not.toBeNull();
  });

  it('ignora la reentrega del mismo mensaje', async () => {
    // WhatsApp reintenta si no recibe el 200 a tiempo: procesar dos veces
    // duplicaría el pedido.
    await escribir('una muzzarella grande', { providerMessageId: 'wamid.repetido' });
    const segunda = await escribir('una muzzarella grande', { providerMessageId: 'wamid.repetido' });

    expect(segunda.reply).toBeNull();

    const conversation = await prisma.conversation.findFirst();
    const draft = conversation?.draft as { items: { quantity: number }[] };
    expect(draft.items[0]?.quantity).toBe(1);
  });

  it('abre la ventana de 24 horas al recibir un mensaje', async () => {
    await prisma.customer.create({
      data: { commerceId: ctx.commerceId, name: 'Martina', phoneE164: '+59899123456' },
    });

    await escribir('hola');

    const customer = await prisma.customer.findFirst({ where: { phoneE164: '+59899123456' } });
    expect(customer?.lastInboundAt).not.toBeNull();
  });
});
