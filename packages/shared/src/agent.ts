import { z } from 'zod';
import { phoneSchema } from './customers.js';

/**
 * Asistente conversacional.
 *
 * El contrato es deliberadamente independiente de WhatsApp: un mensaje entrante
 * es "alguien identificado por un teléfono escribió este texto". WhatsApp,
 * n8n o el simulador del panel son adaptadores que traducen a esta forma, y
 * ninguno de ellos aparece en el núcleo.
 */

export const CONVERSATION_CHANNELS = ['WHATSAPP', 'SIMULATOR'] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const CONVERSATION_STATUSES = ['BOT', 'HUMAN', 'CLOSED'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_ROLES = ['CUSTOMER', 'ASSISTANT', 'TOOL', 'STAFF'] as const;
export type ConversationRole = (typeof CONVERSATION_ROLES)[number];

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  BOT: 'Atiende el asistente',
  HUMAN: 'Atiende una persona',
  CLOSED: 'Cerrada',
};

export const CONVERSATION_CHANNEL_LABELS: Record<ConversationChannel, string> = {
  WHATSAPP: 'WhatsApp',
  SIMULATOR: 'Simulador',
};

/** Mensaje entrante, ya traducido desde el canal que lo trajo. */
export const inboundMessageSchema = z.object({
  phone: phoneSchema,
  text: z.string().max(4000).default(''),
  contactName: z.string().max(120).trim().optional(),
  channel: z.enum(CONVERSATION_CHANNELS).default('WHATSAPP'),
  /** Imagen adjunta: el caso real es la captura del comprobante de pago. */
  mediaId: z.string().max(200).optional(),
  mediaType: z.string().max(100).optional(),
  /** Identificador en el proveedor. Sirve para descartar reentregas. */
  providerMessageId: z.string().max(200).optional(),
});
export type InboundMessageInput = z.infer<typeof inboundMessageSchema>;

export interface ConversationMessageDto {
  id: string;
  role: ConversationRole;
  body: string;
  toolName: string | null;
  mediaId: string | null;
  createdAt: string;
}

export interface ConversationSummaryDto {
  id: string;
  channel: ConversationChannel;
  phoneE164: string;
  contactName: string | null;
  status: ConversationStatus;
  handoffReason: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  customerId: string | null;
}

export interface ConversationDto extends ConversationSummaryDto {
  messages: ConversationMessageDto[];
}

/** Lo que devuelve procesar un mensaje entrante. */
export interface AgentReplyDto {
  conversation: ConversationDto;
  /** Texto que se le respondió al cliente. Vacío si quedó en manos de una persona. */
  reply: string | null;
  /** Herramientas que se ejecutaron para responder, en orden. */
  toolsUsed: string[];
}

export const handoffSchema = z.object({
  reason: z.string().min(1).max(300).trim(),
});
export type HandoffInput = z.infer<typeof handoffSchema>;

export const resumeBotSchema = z.object({
  note: z.string().max(300).trim().optional(),
});
export type ResumeBotInput = z.infer<typeof resumeBotSchema>;

export const staffReplySchema = z.object({
  text: z.string().min(1).max(4000).trim(),
});
export type StaffReplyInput = z.infer<typeof staffReplySchema>;
