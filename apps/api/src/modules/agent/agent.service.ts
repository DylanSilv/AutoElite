import {
  formatMoney,
  type AgentReplyDto,
  type ConversationDto,
  type ConversationMessageDto,
  type ConversationSummaryDto,
  type InboundMessageInput,
  type Page,
} from '@autoelite/shared';
import type { Conversation, ConversationMessage, Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import type { TenantContext } from '../../http/context.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { buildPage, decodeCursor } from '../../shared/pagination.js';
import { normalizePhone } from '../../shared/phone.js';
import { recordInboundMessage } from '../messaging/messaging.service.js';
import { missingFields, parseDraft, type OrderDraft } from './agent.draft.js';
import { buildSystemPrompt } from './agent.prompt.js';
import {
  AGENT_TOOL_DEFINITIONS,
  runTool,
  type AgentToolContext,
} from './agent.tools.js';
import { getLlmProvider } from './llm.factory.js';
import { IMAGE_MARKER } from './llm.scripted.js';
import type { LlmMessage } from './llm.provider.js';

/**
 * Runtime del asistente.
 *
 * Recibe un mensaje ya traducido a la forma neutra (teléfono + texto), decide
 * con el proveedor de IA qué herramientas ejecutar, y devuelve la respuesta.
 * WhatsApp, n8n o el simulador del panel son adaptadores que entran por acá:
 * ninguno aparece en este archivo, y por eso agregar otro canal no toca nada de
 * lo que ya funciona.
 */

/** Cuántos mensajes previos se le muestran al modelo. */
const HISTORY_LIMIT = 20;

// ---------------------------------------------------------------------------
// Mapeo a DTOs
// ---------------------------------------------------------------------------

function toMessageDto(message: ConversationMessage): ConversationMessageDto {
  return {
    id: message.publicId,
    role: message.role,
    body: message.body,
    toolName: message.toolName,
    mediaId: message.mediaId,
    createdAt: message.createdAt.toISOString(),
  };
}

type ConversationWithMessages = Conversation & {
  messages: ConversationMessage[];
  customer?: { publicId: string } | null;
};

function toSummaryDto(
  conversation: Conversation & { messages: ConversationMessage[] },
  customerPublicId: string | null = null,
): ConversationSummaryDto {
  // El último mensaje visible para una persona: los resultados de herramientas
  // son ruido en una lista de conversaciones.
  const visible = conversation.messages.filter((message) => message.role !== 'TOOL');
  const last = visible.at(-1);

  return {
    id: conversation.publicId,
    channel: conversation.channel,
    phoneE164: conversation.phoneE164,
    contactName: conversation.contactName,
    status: conversation.status,
    handoffReason: conversation.handoffReason,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    lastMessagePreview: last ? last.body.slice(0, 140) : '',
    customerId: customerPublicId,
  };
}

function toConversationDto(
  conversation: ConversationWithMessages,
): ConversationDto {
  return {
    ...toSummaryDto(conversation, conversation.customer?.publicId ?? null),
    messages: conversation.messages.map(toMessageDto),
  };
}

// ---------------------------------------------------------------------------
// Conversaciones
// ---------------------------------------------------------------------------

async function loadConversation(ctx: TenantContext, id: number): Promise<ConversationWithMessages> {
  const conversation = await ctx.db.conversation.findFirst({
    where: { id },
    include: {
      messages: { orderBy: { id: 'asc' }, take: 200 },
    },
  });
  if (!conversation) throw new NotFoundError('La conversación no existe');

  const customer = conversation.customerId
    ? await ctx.db.customer.findFirst({ where: { id: conversation.customerId } })
    : null;

  return { ...conversation, customer };
}

async function findOrCreateConversation(
  ctx: TenantContext,
  input: { phoneE164: string; channel: 'WHATSAPP' | 'SIMULATOR'; contactName?: string },
): Promise<Conversation> {
  const existing = await ctx.db.conversation.findFirst({
    where: { phoneE164: input.phoneE164, channel: input.channel },
  });

  const customer = await ctx.db.customer.findFirst({ where: { phoneE164: input.phoneE164 } });

  if (existing) {
    // El nombre del contacto puede haber cambiado en la agenda de WhatsApp, y
    // el cliente puede haberse creado después de la primera conversación.
    if (
      (input.contactName && input.contactName !== existing.contactName) ||
      (customer && customer.id !== existing.customerId)
    ) {
      return ctx.db.conversation.update({
        where: { id: existing.id },
        data: {
          ...(input.contactName ? { contactName: input.contactName } : {}),
          ...(customer ? { customerId: customer.id } : {}),
        },
      });
    }
    return existing;
  }

  return ctx.db.conversation.create({
    data: {
      commerceId: ctx.commerceId,
      channel: input.channel,
      phoneE164: input.phoneE164,
      contactName: input.contactName ?? customer?.name ?? null,
      customerId: customer?.id ?? null,
    },
  });
}

async function appendMessage(
  ctx: TenantContext,
  conversationId: number,
  data: {
    role: 'CUSTOMER' | 'ASSISTANT' | 'TOOL' | 'STAFF';
    body: string;
    toolName?: string;
    toolArgs?: Prisma.InputJsonValue;
    toolResult?: Prisma.InputJsonValue;
    mediaId?: string;
    mediaType?: string;
    providerMessageId?: string;
  },
): Promise<ConversationMessage> {
  return ctx.db.conversationMessage.create({
    data: {
      commerceId: ctx.commerceId,
      conversationId,
      role: data.role,
      body: data.body,
      toolName: data.toolName ?? null,
      ...(data.toolArgs !== undefined ? { toolArgs: data.toolArgs } : {}),
      ...(data.toolResult !== undefined ? { toolResult: data.toolResult } : {}),
      mediaId: data.mediaId ?? null,
      mediaType: data.mediaType ?? null,
      providerMessageId: data.providerMessageId ?? null,
    },
  });
}

/**
 * Historial que ve el modelo.
 *
 * Sólo los turnos que vio el cliente. Los resultados de herramientas de
 * mensajes anteriores quedan fuera a propósito: son datos de hace horas —
 * precios, estados, disponibilidad— y volver a mostrárselos al modelo lo
 * llevaría a repetir información vencida. Lo que sí sobrevive entre mensajes es
 * el borrador del pedido, que viaja aparte como estado.
 */
async function buildHistory(ctx: TenantContext, conversationId: number): Promise<LlmMessage[]> {
  const rows = await ctx.db.conversationMessage.findMany({
    where: { conversationId, role: { in: ['CUSTOMER', 'ASSISTANT', 'STAFF'] } },
    orderBy: { id: 'desc' },
    take: HISTORY_LIMIT,
  });

  return rows
    .reverse()
    .map((message): LlmMessage =>
      message.role === 'CUSTOMER'
        ? { role: 'user', content: message.body }
        : { role: 'assistant', content: message.body },
    );
}

/** Estado del borrador, en la forma en que lo lee el modelo. */
function draftState(ctx: TenantContext, draft: OrderDraft): Record<string, unknown> {
  const faltan = missingFields(draft);
  return {
    items: draft.items.map((item) => ({
      cantidad: item.quantity,
      producto: item.label,
      importe: formatMoney(item.unitPriceCents * item.quantity, ctx.commerce.currency, 'es-UY'),
    })),
    modalidad: draft.type ?? null,
    direccion: draft.address
      ? `${draft.address.street}${draft.address.number ? ` ${draft.address.number}` : ''}`
      : null,
    zona: draft.deliveryZoneName ?? null,
    medio_de_pago: draft.paymentMethodName ?? null,
    faltan,
    listo_para_confirmar: faltan.length === 0 && draft.items.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Procesamiento de un mensaje entrante
// ---------------------------------------------------------------------------

export async function handleInboundMessage(
  ctx: TenantContext,
  input: InboundMessageInput,
): Promise<AgentReplyDto> {
  const phoneE164 = normalizePhone(input.phone, ctx.commerce.country);
  const text = input.text.trim();

  if (!text && !input.mediaId) {
    throw new ValidationError('El mensaje no tiene ni texto ni imagen');
  }

  const conversation = await findOrCreateConversation(ctx, {
    phoneE164,
    channel: input.channel,
    ...(input.contactName ? { contactName: input.contactName } : {}),
  });

  // Reentrega del proveedor: WhatsApp reintenta si no recibe el 200 a tiempo, y
  // procesar dos veces el mismo mensaje duplicaría el pedido.
  if (input.providerMessageId) {
    const seen = await ctx.db.conversationMessage.findFirst({
      where: { providerMessageId: input.providerMessageId },
    });
    if (seen) {
      const existing = await loadConversation(ctx, conversation.id);
      return { conversation: toConversationDto(existing), reply: null, toolsUsed: [] };
    }
  }

  // Marca la ventana de 24 horas de WhatsApp: a partir de ahora se le puede
  // escribir libremente.
  await recordInboundMessage(ctx.commerceId, phoneE164);

  const inboundBody = input.mediaId ? `${text} ${IMAGE_MARKER}`.trim() : text;
  await appendMessage(ctx, conversation.id, {
    role: 'CUSTOMER',
    body: inboundBody,
    ...(input.mediaId ? { mediaId: input.mediaId } : {}),
    ...(input.mediaType ? { mediaType: input.mediaType } : {}),
    ...(input.providerMessageId ? { providerMessageId: input.providerMessageId } : {}),
  });
  await ctx.db.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  // Derivada a una persona: el asistente se calla. Volver a contestar por
  // encima de alguien del local sería peor que no contestar.
  if (conversation.status !== 'BOT') {
    const loaded = await loadConversation(ctx, conversation.id);
    return { conversation: toConversationDto(loaded), reply: null, toolsUsed: [] };
  }

  const { reply, toolsUsed } = await runAgentLoop(ctx, conversation, {
    inboundBody,
    ...(input.mediaId ? { media: { id: input.mediaId, type: input.mediaType } } : {}),
  });

  const loaded = await loadConversation(ctx, conversation.id);
  return { conversation: toConversationDto(loaded), reply, toolsUsed };
}

interface LoopInput {
  inboundBody: string;
  media?: { id?: string; type?: string };
}

/**
 * Vuelta modelo → herramienta → modelo, con techo de rondas.
 *
 * El techo no es defensivo por gusto: un modelo puede quedarse pidiendo la
 * carta en loop, y cada vuelta cuesta plata y demora la respuesta al cliente.
 */
async function runAgentLoop(
  ctx: TenantContext,
  conversation: Conversation,
  input: LoopInput,
): Promise<{ reply: string | null; toolsUsed: string[] }> {
  const provider = getLlmProvider();
  const system = buildSystemPrompt(ctx.commerce);
  const draft = parseDraft(conversation.draft);

  let handoffReason: string | null = null;
  const toolContext: AgentToolContext = {
    ctx,
    conversationId: conversation.id,
    phoneE164: conversation.phoneE164,
    contactName: conversation.contactName,
    draft,
    media: input.media ?? null,
    requestHandoff: (reason) => {
      handoffReason = reason;
    },
  };

  const history = await buildHistory(ctx, conversation.id);
  const messages: LlmMessage[] = [...history];
  const toolsUsed: string[] = [];
  let reply: string | null = null;

  for (let round = 0; round < env.AGENT_MAX_TOOL_ROUNDS; round += 1) {
    const completion = await provider.complete({
      system,
      messages,
      tools: AGENT_TOOL_DEFINITIONS,
      state: draftState(ctx, draft),
    });

    if (completion.toolCalls.length === 0) {
      reply = completion.text?.trim() || null;
      break;
    }

    messages.push({
      role: 'assistant',
      content: completion.text ?? '',
      toolCalls: completion.toolCalls,
    });

    for (const call of completion.toolCalls) {
      const result = await runTool(toolContext, call.name, call.arguments);
      toolsUsed.push(call.name);

      const serialized = JSON.stringify(result);
      await appendMessage(ctx, conversation.id, {
        role: 'TOOL',
        body: serialized.slice(0, 4000),
        toolName: call.name,
        toolArgs: call.arguments as Prisma.InputJsonValue,
        toolResult: result as Prisma.InputJsonValue,
      });

      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: serialized,
      });
    }
  }

  if (reply === null) {
    logger.warn(
      { conversationId: conversation.publicId, toolsUsed },
      'El asistente agotó las rondas sin redactar una respuesta',
    );
    reply = 'Dame un segundo que lo reviso y te contesto 🙌';
    handoffReason ??= 'El asistente no pudo resolver la consulta';
  }

  await ctx.db.conversation.update({
    where: { id: conversation.id },
    data: {
      draft: draft as unknown as Prisma.InputJsonValue,
      lastMessageAt: new Date(),
      ...(handoffReason ? { status: 'HUMAN', handoffReason } : {}),
    },
  });

  await deliver(ctx, conversation, reply);

  return { reply, toolsUsed };
}

/**
 * Deja la respuesta en la conversación y, si el canal es real, en la cola de
 * salida. El simulador no encola nada: es para mirar cómo responde, no para
 * mandarle un WhatsApp a nadie.
 */
async function deliver(
  ctx: TenantContext,
  conversation: Conversation,
  reply: string,
): Promise<void> {
  await appendMessage(ctx, conversation.id, { role: 'ASSISTANT', body: reply });

  if (conversation.channel === 'SIMULATOR') return;

  await ctx.db.outboundMessage.create({
    data: {
      commerceId: ctx.commerceId,
      customerId: conversation.customerId,
      toPhoneE164: conversation.phoneE164,
      kind: 'AGENT_REPLY',
      body: reply,
    },
  });
}

// ---------------------------------------------------------------------------
// Operaciones del panel
// ---------------------------------------------------------------------------

export async function listConversations(
  ctx: TenantContext,
  params: { limit: number; cursor?: string; status?: string },
): Promise<Page<ConversationSummaryDto>> {
  const rows = await ctx.db.conversation.findMany({
    where: params.status ? { status: params.status as 'BOT' | 'HUMAN' | 'CLOSED' } : {},
    take: params.limit + 1,
    ...(params.cursor ? { cursor: { id: decodeCursor(params.cursor) }, skip: 1 } : {}),
    orderBy: { lastMessageAt: 'desc' },
    include: { messages: { orderBy: { id: 'desc' }, take: 5 } },
  });

  return buildPage(rows, params.limit, (row) =>
    // Los mensajes vienen del más nuevo al más viejo para no traer el hilo
    // entero; el resumen los espera al derecho.
    toSummaryDto({ ...row, messages: [...row.messages].reverse() }),
  );
}

export async function getConversation(
  ctx: TenantContext,
  publicId: string,
): Promise<ConversationDto> {
  const conversation = await ctx.db.conversation.findFirst({ where: { publicId } });
  if (!conversation) throw new NotFoundError('La conversación no existe');
  return toConversationDto(await loadConversation(ctx, conversation.id));
}

/** Saca al asistente y deja la conversación en manos del personal. */
export async function handOff(
  ctx: TenantContext,
  publicId: string,
  reason: string,
): Promise<ConversationDto> {
  const conversation = await ctx.db.conversation.findFirst({ where: { publicId } });
  if (!conversation) throw new NotFoundError('La conversación no existe');

  await ctx.db.conversation.update({
    where: { id: conversation.id },
    data: { status: 'HUMAN', handoffReason: reason },
  });

  return toConversationDto(await loadConversation(ctx, conversation.id));
}

/** Devuelve la conversación al asistente. */
export async function resumeBot(ctx: TenantContext, publicId: string): Promise<ConversationDto> {
  const conversation = await ctx.db.conversation.findFirst({ where: { publicId } });
  if (!conversation) throw new NotFoundError('La conversación no existe');

  await ctx.db.conversation.update({
    where: { id: conversation.id },
    data: { status: 'BOT', handoffReason: null },
  });

  return toConversationDto(await loadConversation(ctx, conversation.id));
}

/**
 * Mensaje escrito por una persona del local.
 *
 * Escribir manualmente implica que la conversación pasa a ser suya: si el
 * asistente siguiera contestando, los dos le hablarían al cliente a la vez.
 */
export async function sendStaffReply(
  ctx: TenantContext,
  publicId: string,
  text: string,
): Promise<ConversationDto> {
  const conversation = await ctx.db.conversation.findFirst({ where: { publicId } });
  if (!conversation) throw new NotFoundError('La conversación no existe');

  await appendMessage(ctx, conversation.id, { role: 'STAFF', body: text });

  await ctx.db.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: new Date(),
      ...(conversation.status === 'BOT'
        ? { status: 'HUMAN', handoffReason: 'Respondió una persona del local' }
        : {}),
    },
  });

  if (conversation.channel !== 'SIMULATOR') {
    await ctx.db.outboundMessage.create({
      data: {
        commerceId: ctx.commerceId,
        customerId: conversation.customerId,
        toPhoneE164: conversation.phoneE164,
        kind: 'AGENT_REPLY',
        body: text,
      },
    });
  }

  return toConversationDto(await loadConversation(ctx, conversation.id));
}
