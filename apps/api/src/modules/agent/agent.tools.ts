import { formatMoney, type OrderType } from '@autoelite/shared';
import type { TenantContext } from '../../http/context.js';
import { logger } from '../../shared/logger.js';
import { listActivePromotions } from '../promotions/promotions.service.js';
import { createOrder } from '../orders/orders.service.js';
import { submitPaymentProof } from '../orders/orders.payments.js';
import { bestMatch, normalize } from './agent.matching.js';
import {
  clearDraft,
  isReadyToConfirm,
  missingFields,
  type DraftAddress,
  type DraftItem,
  type OrderDraft,
} from './agent.draft.js';
import type { LlmToolDefinition } from './llm.provider.js';

/**
 * Lo que el asistente sabe hacer.
 *
 * Cada herramienta es una llamada a los mismos services que usa el panel: los
 * precios, la disponibilidad y las reglas de cobro salen siempre de la base.
 * El modelo elige cuál llamar y con qué argumentos; no puede inventar un precio
 * ni saltearse el cobro previo, porque nunca los toca.
 *
 * Los nombres y los argumentos están en español a propósito: son lo que el
 * modelo lee, y el contexto de la conversación también lo es.
 */

export interface AgentToolContext {
  ctx: TenantContext;
  conversationId: number;
  phoneE164: string;
  contactName: string | null;
  /** Borrador del pedido. Las herramientas lo mutan; el runtime lo persiste. */
  draft: OrderDraft;
  /** Imagen que vino en el mensaje entrante, si hubo. */
  media: { id?: string; type?: string } | null;
  /** Pide que una persona siga la conversación. */
  requestHandoff: (reason: string) => void;
}

export interface AgentTool {
  definition: LlmToolDefinition;
  run(context: AgentToolContext, args: Record<string, unknown>): Promise<unknown>;
}

function money(ctx: TenantContext, cents: number): string {
  return formatMoney(cents, ctx.commerce.currency, 'es-UY');
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asOrderType(value: unknown): OrderType | undefined {
  const text = normalize(String(value ?? ''));
  if (!text) return undefined;
  if (['delivery', 'envio', 'domicilio', 'a domicilio', 'reparto'].includes(text)) return 'DELIVERY';
  if (['takeaway', 'retiro', 'take away', 'pickup', 'para llevar'].includes(text)) return 'TAKEAWAY';
  if (['dine in', 'dine_in', 'salon', 'local', 'mesa', 'en el local'].includes(text)) return 'DINE_IN';
  if (text.includes('envi') || text.includes('domicil') || text.includes('deliver')) return 'DELIVERY';
  if (text.includes('retir') || text.includes('llevar') || text.includes('busc')) return 'TAKEAWAY';
  if (text.includes('salon') || text.includes('mesa') || text.includes('local')) return 'DINE_IN';
  return undefined;
}

// ---------------------------------------------------------------------------
// Catálogo, promociones y condiciones
// ---------------------------------------------------------------------------

const verMenu: AgentTool = {
  definition: {
    name: 'ver_menu',
    description:
      'Devuelve el menú del comercio con precios actuales. Usar cuando el cliente pide la carta, ' +
      'pregunta qué hay o cuánto sale algo. El filtro `buscar` acota a un producto concreto.',
    parameters: {
      type: 'object',
      properties: {
        buscar: { type: 'string', description: 'Texto para filtrar productos, ej: "muzzarella"' },
      },
    },
  },
  async run({ ctx }, args) {
    const buscar = asString(args.buscar);
    const products = await ctx.db.product.findMany({
      where: { deletedAt: null, isAvailable: true },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        category: true,
        variants: { where: { isAvailable: true }, orderBy: { sortOrder: 'asc' } },
      },
    });

    const visible = products.filter((product) => {
      if (!buscar) return true;
      const haystack = `${product.name} ${product.description ?? ''} ${product.category.name}`;
      return bestMatch(buscar, [haystack], (text) => text, 0.4) !== null;
    });

    const categorias = new Map<string, { categoria: string; productos: unknown[] }>();
    for (const product of visible) {
      const entry = categorias.get(product.category.name) ?? {
        categoria: product.category.name,
        productos: [],
      };
      entry.productos.push({
        nombre: product.name,
        descripcion: product.description,
        opciones: product.variants.map((variant) => ({
          nombre: variant.name,
          precio: money(ctx, variant.priceCents),
        })),
      });
      categorias.set(product.category.name, entry);
    }

    return { categorias: [...categorias.values()], encontrados: visible.length };
  },
};

const verPromociones: AgentTool = {
  definition: {
    name: 'ver_promociones',
    description:
      'Promociones vigentes hoy. Usar cuando el cliente pregunta por promos, ofertas o descuentos.',
    parameters: { type: 'object', properties: {} },
  },
  async run({ ctx }) {
    const promotions = await listActivePromotions(ctx);
    return {
      promociones: promotions.map((promotion) => ({
        titulo: promotion.title,
        detalle: promotion.description,
      })),
    };
  },
};

const verZonasDeEnvio: AgentTool = {
  definition: {
    name: 'ver_zonas_de_envio',
    description:
      'Zonas a las que se reparte, con su costo y demora estimada. Usar cuando el cliente pregunta ' +
      'si se llega a su barrio o cuánto sale el envío.',
    parameters: { type: 'object', properties: {} },
  },
  async run({ ctx }) {
    const zones = await ctx.db.deliveryZone.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return {
      zonas: zones.map((zone) => ({
        nombre: zone.name,
        costo: money(ctx, zone.feeCents),
        demoraMinutos: zone.estimatedMin,
      })),
    };
  },
};

const verMediosDePago: AgentTool = {
  definition: {
    name: 'ver_medios_de_pago',
    description:
      'Medios de pago habilitados. Indica cuáles exigen pagar antes de que el pedido entre a la ' +
      'cocina y con qué datos se paga.',
    parameters: {
      type: 'object',
      properties: {
        modalidad: {
          type: 'string',
          enum: ['DINE_IN', 'TAKEAWAY', 'DELIVERY'],
          description: 'Filtra los que se pueden usar en esa modalidad',
        },
      },
    },
  },
  async run({ ctx, draft }, args) {
    const type = asOrderType(args.modalidad) ?? draft.type;
    const methods = await ctx.db.paymentMethod.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const usables = methods.filter((method) => {
      if (!type) return true;
      const allowed = Array.isArray(method.allowedOrderTypes)
        ? (method.allowedOrderTypes as string[])
        : null;
      return !allowed || allowed.includes(type);
    });

    return {
      medios: usables.map((method) => ({
        nombre: method.name,
        pagoPorAdelantado: method.requiresPrepayment,
        instrucciones: method.instructions,
        qr: method.qrImageUrl,
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// Armado del pedido
// ---------------------------------------------------------------------------

/** Traduce lo que escribió el cliente a variantes concretas del catálogo. */
async function resolveItems(
  ctx: TenantContext,
  requested: { texto?: unknown; cantidad?: unknown }[],
): Promise<{ items: DraftItem[]; noEncontrados: string[] }> {
  const variants = await ctx.db.productVariant.findMany({
    where: { isAvailable: true, deletedAt: null, product: { isAvailable: true, deletedAt: null } },
    include: { product: true },
  });

  const items: DraftItem[] = [];
  const noEncontrados: string[] = [];

  for (const entry of requested) {
    const texto = asString(entry.texto);
    if (!texto) continue;
    const cantidad = Math.min(Math.max(Number(entry.cantidad) || 1, 1), 50);

    const match = bestMatch(
      texto,
      variants,
      (variant) => `${variant.product.name} ${variant.name}`,
      0.5,
    );

    if (!match) {
      noEncontrados.push(texto);
      continue;
    }

    const variant = match.value;
    const label = `${variant.product.name} (${variant.name})`;
    const existing = items.find((item) => item.variantId === variant.publicId);
    if (existing) {
      existing.quantity += cantidad;
      continue;
    }

    items.push({
      variantId: variant.publicId,
      quantity: cantidad,
      label,
      unitPriceCents: variant.priceCents,
    });
  }

  return { items, noEncontrados };
}

function draftSummary(ctx: TenantContext, draft: OrderDraft, deliveryFeeCents: number) {
  const subtotal = draft.items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0,
  );
  return {
    items: draft.items.map((item) => ({
      cantidad: item.quantity,
      producto: item.label,
      importe: money(ctx, item.unitPriceCents * item.quantity),
    })),
    subtotal: money(ctx, subtotal),
    envio: deliveryFeeCents > 0 ? money(ctx, deliveryFeeCents) : null,
    total: money(ctx, subtotal + deliveryFeeCents),
    totalCents: subtotal + deliveryFeeCents,
  };
}

async function resolveZoneFee(
  ctx: TenantContext,
  draft: OrderDraft,
): Promise<number> {
  if (draft.type !== 'DELIVERY' || !draft.deliveryZoneId) return 0;
  const zone = await ctx.db.deliveryZone.findFirst({ where: { publicId: draft.deliveryZoneId } });
  return zone?.feeCents ?? 0;
}

/**
 * Busca la zona que corresponde a un barrio escrito a mano.
 *
 * Si no la reconoce no inventa: deja el pedido sin zona y el costo del envío lo
 * define el personal. Cobrar de menos por adivinar mal sale del bolsillo del
 * comercio.
 */
async function resolveZone(ctx: TenantContext, text: string | undefined) {
  if (!text) return null;
  const zones = await ctx.db.deliveryZone.findMany({ where: { isActive: true } });
  return bestMatch(text, zones, (zone) => zone.name, 0.5)?.value ?? null;
}

const armarPedido: AgentTool = {
  definition: {
    name: 'armar_pedido',
    description:
      'Agrega o corrige datos del pedido en curso y devuelve el resumen con el total y qué falta. ' +
      'Llamar cada vez que el cliente elige productos, la modalidad, la dirección o el medio de ' +
      'pago. No crea el pedido: sólo lo arma.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Productos que pide el cliente, tal como los nombró',
          items: {
            type: 'object',
            properties: {
              texto: { type: 'string' },
              cantidad: { type: 'number' },
            },
            required: ['texto'],
          },
        },
        modalidad: {
          type: 'string',
          enum: ['DINE_IN', 'TAKEAWAY', 'DELIVERY'],
          description: 'DELIVERY = envío, TAKEAWAY = retira, DINE_IN = come en el local',
        },
        direccion: {
          type: 'object',
          properties: {
            calle: { type: 'string' },
            numero: { type: 'string' },
            apartamento: { type: 'string' },
            barrio: { type: 'string' },
            referencia: { type: 'string' },
          },
        },
        medio_de_pago: { type: 'string', description: 'Nombre del medio, ej: "transferencia"' },
        nombre: { type: 'string', description: 'Nombre del cliente, si lo dijo' },
        notas: { type: 'string', description: 'Aclaraciones: sin cebolla, cortada en 8, etc.' },
        reemplazar_items: {
          type: 'boolean',
          description: 'true si el cliente cambia el pedido entero en vez de agregar',
        },
      },
    },
  },
  async run(context, args) {
    const { ctx, draft } = context;
    let noEncontrados: string[] = [];
    let zonaNoReconocida: string | null = null;

    if (Array.isArray(args.items) && args.items.length > 0) {
      const resolved = await resolveItems(ctx, args.items as { texto?: unknown }[]);
      noEncontrados = resolved.noEncontrados;
      if (args.reemplazar_items === true) {
        draft.items = resolved.items;
      } else {
        for (const item of resolved.items) {
          const existing = draft.items.find((other) => other.variantId === item.variantId);
          if (existing) existing.quantity += item.quantity;
          else draft.items.push(item);
        }
      }
    }

    const modalidad = asOrderType(args.modalidad);
    if (modalidad) draft.type = modalidad;

    const direccion = args.direccion as Record<string, unknown> | undefined;
    if (direccion) {
      const calle = asString(direccion.calle);
      const numero = asString(direccion.numero);
      const apartamento = asString(direccion.apartamento);
      const barrio = asString(direccion.barrio);
      const referencia = asString(direccion.referencia);

      if (calle) {
        const address: DraftAddress = { street: calle };
        if (numero) address.number = numero;
        if (apartamento) address.apartment = apartamento;
        if (barrio) address.neighborhood = barrio;
        if (referencia) address.reference = referencia;
        draft.address = address;
        // Una dirección implica envío: nadie da la calle para comer en el local.
        draft.type ??= 'DELIVERY';
      } else if (draft.address) {
        // El barrio suele llegar en un mensaje aparte, después de la calle.
        if (barrio) draft.address.neighborhood = barrio;
        if (referencia) draft.address.reference = referencia;
        if (apartamento) draft.address.apartment = apartamento;
      }

      const paraZona = barrio ?? draft.address?.neighborhood ?? calle;
      const zone = await resolveZone(ctx, paraZona);
      if (zone) {
        draft.deliveryZoneId = zone.publicId;
        draft.deliveryZoneName = zone.name;
      } else if (barrio) {
        // Dijo un barrio y no es ninguno de los que se reparte. Se le contesta
        // con las zonas reales en vez de dejarlo esperando un envío que no
        // existe.
        zonaNoReconocida = barrio;
      }
    }

    const medio = asString(args.medio_de_pago);
    if (medio) {
      const methods = await ctx.db.paymentMethod.findMany({ where: { isActive: true } });
      const allowed = methods.filter((method) => {
        const types = Array.isArray(method.allowedOrderTypes)
          ? (method.allowedOrderTypes as string[])
          : null;
        return !draft.type || !types || types.includes(draft.type);
      });
      const match = bestMatch(medio, allowed, (method) => `${method.name} ${method.code}`, 0.4);
      if (match) {
        draft.paymentMethodId = match.value.publicId;
        draft.paymentMethodName = match.value.name;
      } else {
        // Puede ser que el medio exista pero no para esta modalidad: es el caso
        // del efectivo en un envío, y decirlo evita una discusión en la puerta.
        const anyMatch = bestMatch(medio, methods, (method) => method.name, 0.4);
        return {
          error: anyMatch
            ? `${anyMatch.value.name} no está disponible para esta modalidad`
            : 'No reconocí ese medio de pago',
          medios_disponibles: allowed.map((method) => method.name),
        };
      }
    }

    const nombre = asString(args.nombre);
    if (nombre) draft.customerName = nombre;
    const notas = asString(args.notas);
    if (notas) draft.notes = draft.notes ? `${draft.notes}. ${notas}` : notas;

    const feeCents = await resolveZoneFee(ctx, draft);
    const faltan = missingFields(draft);

    const zonasDisponibles = zonaNoReconocida
      ? (await ctx.db.deliveryZone.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })).map(
          (zone) => zone.name,
        )
      : [];

    return {
      resumen: draftSummary(ctx, draft, feeCents),
      modalidad: draft.type ?? null,
      direccion: draft.address
        ? `${draft.address.street}${draft.address.number ? ` ${draft.address.number}` : ''}`
        : null,
      zona: draft.deliveryZoneName ?? null,
      zona_no_reconocida: zonaNoReconocida,
      zonas_disponibles: zonasDisponibles,
      medio_de_pago: draft.paymentMethodName ?? null,
      faltan,
      listo_para_confirmar: faltan.length === 0,
      no_encontrados: noEncontrados,
    };
  },
};

const vaciarPedido: AgentTool = {
  definition: {
    name: 'vaciar_pedido',
    description: 'Descarta el pedido en curso. Usar si el cliente se arrepiente o quiere empezar de nuevo.',
    parameters: { type: 'object', properties: {} },
  },
  async run(context) {
    clearDraft(context.draft);
    return { vaciado: true };
  },
};

const confirmarPedido: AgentTool = {
  definition: {
    name: 'confirmar_pedido',
    description:
      'Crea el pedido con lo que está armado. Llamar sólo cuando el cliente confirma explícitamente ' +
      'y no falta ningún dato. Devuelve el número de pedido y, si el medio exige pagar antes, las ' +
      'instrucciones de pago.',
    parameters: { type: 'object', properties: {} },
  },
  async run(context) {
    const { ctx, draft } = context;
    const faltan = missingFields(draft);
    if (!isReadyToConfirm(draft)) {
      return { error: 'El pedido todavía no está completo', faltan };
    }

    const order = await createOrder(ctx, {
      type: draft.type as OrderType,
      source: 'WHATSAPP',
      customerName: draft.customerName ?? context.contactName ?? 'Cliente',
      customerPhone: context.phoneE164,
      paymentMethodId: draft.paymentMethodId,
      items: draft.items.map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
        modifierOptionIds: [],
        ...(item.notes ? { notes: item.notes } : {}),
      })),
      ...(draft.type === 'DELIVERY' && draft.address
        ? {
            address: {
              street: draft.address.street,
              ...(draft.address.number ? { number: draft.address.number } : {}),
              ...(draft.address.apartment ? { apartment: draft.address.apartment } : {}),
              ...(draft.address.neighborhood ? { neighborhood: draft.address.neighborhood } : {}),
              ...(draft.address.reference ? { reference: draft.address.reference } : {}),
              ...(draft.deliveryZoneId ? { deliveryZoneId: draft.deliveryZoneId } : {}),
            },
          }
        : {}),
      ...(draft.notes ? { notes: draft.notes } : {}),
      isPaid: false,
      discountCents: 0,
    });

    const paymentMethodId = draft.paymentMethodId;

    // El pedido ya está en la base: el borrador dejó de tener sentido.
    clearDraft(draft);

    const requierePago = order.paymentStatus === 'PENDING';
    const method = paymentMethodId
      ? await ctx.db.paymentMethod.findFirst({ where: { publicId: paymentMethodId } })
      : null;

    return {
      numero: order.number,
      total: money(ctx, order.totalCents),
      modalidad: order.type,
      requiere_pago_antes: requierePago,
      instrucciones_de_pago: requierePago ? method?.instructions ?? null : null,
      qr: requierePago ? method?.qrImageUrl ?? null : null,
    };
  },
};

// ---------------------------------------------------------------------------
// Seguimiento y pago
// ---------------------------------------------------------------------------

const consultarPedido: AgentTool = {
  definition: {
    name: 'consultar_pedido',
    description:
      'Estado del último pedido del cliente. Usar cuando pregunta cómo viene, cuánto falta o si ya salió.',
    parameters: {
      type: 'object',
      properties: { numero: { type: 'number', description: 'Número de pedido, si lo dio' } },
    },
  },
  async run({ ctx, phoneE164 }, args) {
    const numero = Number(args.numero);
    const order = await ctx.db.order.findFirst({
      where: {
        customerPhone: phoneE164,
        ...(Number.isInteger(numero) && numero > 0 ? { number: numero } : {}),
      },
      orderBy: { id: 'desc' },
    });

    if (!order) return { encontrado: false };

    return {
      encontrado: true,
      numero: order.number,
      estado: order.status,
      modalidad: order.type,
      estado_del_pago: order.paymentStatus,
      total: money(ctx, order.totalCents),
    };
  },
};

const registrarComprobante: AgentTool = {
  definition: {
    name: 'registrar_comprobante',
    description:
      'Registra el comprobante de pago que mandó el cliente para que el local lo verifique. ' +
      'Usar cuando adjunta una imagen o dice que ya pagó. No confirma el pago: eso lo hace una persona.',
    parameters: {
      type: 'object',
      properties: { nota: { type: 'string', description: 'Lo que escribió junto al comprobante' } },
    },
  },
  async run({ ctx, phoneE164, media }, args) {
    const order = await ctx.db.order.findFirst({
      where: {
        customerPhone: phoneE164,
        paymentStatus: { in: ['PENDING', 'REJECTED', 'PROOF_SUBMITTED'] },
      },
      orderBy: { id: 'desc' },
    });

    if (!order) return { registrado: false, motivo: 'No hay ningún pedido esperando pago' };
    if (!media?.id) {
      return {
        registrado: false,
        motivo: 'Hace falta la captura del comprobante',
      };
    }

    await submitPaymentProof(ctx, order, {
      whatsappMediaId: media.id,
      ...(media.type ? { mimeType: media.type } : {}),
      ...(asString(args.nota) ? { note: asString(args.nota) as string } : {}),
    });

    return { registrado: true, numero: order.number };
  },
};

const derivarAPersona: AgentTool = {
  definition: {
    name: 'derivar_a_persona',
    description:
      'Deja la conversación en manos del personal y deja de responder automáticamente. Usar ante un ' +
      'reclamo, un pedido de hablar con alguien, o cualquier cosa que no se pueda resolver con las ' +
      'otras herramientas.',
    parameters: {
      type: 'object',
      properties: { motivo: { type: 'string' } },
      required: ['motivo'],
    },
  },
  async run(context, args) {
    const motivo = asString(args.motivo) ?? 'El cliente pidió hablar con una persona';
    context.requestHandoff(motivo);
    return { derivado: true, motivo };
  },
};

export const AGENT_TOOLS: AgentTool[] = [
  verMenu,
  verPromociones,
  verZonasDeEnvio,
  verMediosDePago,
  armarPedido,
  vaciarPedido,
  confirmarPedido,
  consultarPedido,
  registrarComprobante,
  derivarAPersona,
];

export const AGENT_TOOL_DEFINITIONS: LlmToolDefinition[] = AGENT_TOOLS.map((tool) => tool.definition);

export function findTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((tool) => tool.definition.name === name);
}

/**
 * Ejecuta una herramienta y devuelve siempre algo serializable.
 *
 * Un error acá no puede cortar la conversación: el cliente tiene que recibir
 * una respuesta aunque una consulta falle, y el error queda en el log con el
 * pedido completo para poder reproducirlo.
 */
export async function runTool(
  context: AgentToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = findTool(name);
  if (!tool) return { error: `La herramienta ${name} no existe` };

  try {
    return await tool.run(context, args);
  } catch (err) {
    logger.error({ err, tool: name, args }, 'Falló una herramienta del asistente');
    return {
      error: err instanceof Error ? err.message : 'No se pudo completar la operación',
    };
  }
}
