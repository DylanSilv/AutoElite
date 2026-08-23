import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../shared/logger.js';
import { buildAgentContext, findCommerceByWhatsAppNumber } from './agent.context.js';
import { handleInboundMessage } from './agent.service.js';

/**
 * Adaptador de WhatsApp Cloud API.
 *
 * Es lo único del sistema que conoce el formato de Meta. Traduce cada mensaje
 * entrante a la forma neutra que entiende el asistente y se corre del camino:
 * si mañana el negocio suma Instagram o un chat web, se escribe otro archivo
 * como este y no se toca nada más.
 *
 * Va fuera de /api/v1 y sin autenticación nuestra porque quien llama es Meta,
 * que no tiene nuestras credenciales. La autenticidad se verifica con la firma
 * HMAC de cada entrega.
 */

export const whatsappWebhookRouter: Router = Router();

/** Ruta que hay que registrar en Meta. */
export const WHATSAPP_WEBHOOK_PATH = '/webhooks/whatsapp';

interface WhatsAppMessage {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; caption?: string };
  button?: { text?: string };
  interactive?: { list_reply?: { title?: string }; button_reply?: { title?: string } };
}

interface WhatsAppValue {
  metadata?: { phone_number_id?: string };
  contacts?: { profile?: { name?: string }; wa_id?: string }[];
  messages?: WhatsAppMessage[];
  statuses?: { id?: string; status?: string; errors?: { title?: string }[] }[];
}

interface WhatsAppPayload {
  entry?: { changes?: { value?: WhatsAppValue }[] }[];
}

/**
 * Verifica que la entrega venga de Meta.
 *
 * Sin esto, cualquiera que conozca la URL puede inyectar pedidos falsos en la
 * cocina. Si no hay secreto configurado se rechaza en producción: fallar el
 * alta del webhook es preferible a aceptar mensajes de cualquier origen.
 */
function hasValidSignature(req: Request): boolean {
  if (!env.WHATSAPP_APP_SECRET) return env.NODE_ENV !== 'production';

  const header = req.get('x-hub-signature-256');
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!header || !raw) return false;

  const expected = `sha256=${createHmac('sha256', env.WHATSAPP_APP_SECRET).update(raw).digest('hex')}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Texto útil de un mensaje, sea del tipo que sea. */
function extractText(message: WhatsAppMessage): string {
  return (
    message.text?.body ??
    message.image?.caption ??
    message.document?.caption ??
    message.button?.text ??
    message.interactive?.list_reply?.title ??
    message.interactive?.button_reply?.title ??
    ''
  ).trim();
}

// Alta del webhook: Meta llama una vez con un token que definimos nosotros.
whatsappWebhookRouter.get(WHATSAPP_WEBHOOK_PATH, (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
    res.type('text/plain').send(String(challenge ?? ''));
    return;
  }

  logger.warn('Alta de webhook de WhatsApp rechazada: el token no coincide');
  res.sendStatus(403);
});

whatsappWebhookRouter.post(WHATSAPP_WEBHOOK_PATH, async (req, res) => {
  if (!hasValidSignature(req)) {
    logger.warn('Entrega de WhatsApp con firma inválida');
    res.sendStatus(401);
    return;
  }

  // Meta reintenta si no recibe un 200 rápido, y cada reintento sería otro
  // pedido. Se acusa recibo primero y se procesa después; la deduplicación por
  // id del mensaje cubre lo que igual llegue dos veces.
  res.sendStatus(200);

  try {
    await processPayload(req.body as WhatsAppPayload);
  } catch (err) {
    logger.error({ err }, 'No se pudo procesar una entrega de WhatsApp');
  }
});

async function processPayload(payload: WhatsAppPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      await applyStatuses(value);

      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId || !value.messages?.length) continue;

      const commerceId = await findCommerceByWhatsAppNumber(phoneNumberId);
      if (!commerceId) {
        logger.warn({ phoneNumberId }, 'Llegó un mensaje de un número de WhatsApp sin comercio asociado');
        continue;
      }

      const ctx = await buildAgentContext(commerceId);
      if (!ctx) continue;

      const contactName = value.contacts?.[0]?.profile?.name;

      for (const message of value.messages) {
        if (!message.from) continue;

        const media = message.image ?? message.document;
        const text = extractText(message);
        if (!text && !media?.id) continue;

        try {
          await handleInboundMessage(ctx, {
            phone: message.from,
            text,
            channel: 'WHATSAPP',
            ...(contactName ? { contactName } : {}),
            ...(media?.id ? { mediaId: media.id } : {}),
            ...(media?.mime_type ? { mediaType: media.mime_type } : {}),
            ...(message.id ? { providerMessageId: message.id } : {}),
          });
        } catch (err) {
          // Un mensaje que falla no puede frenar a los demás de la misma entrega.
          logger.error({ err, from: message.from }, 'No se pudo responder un mensaje de WhatsApp');
        }
      }
    }
  }
}

/**
 * Acuses de entrega. Sólo interesan los fallos: saber que un aviso no llegó
 * permite que alguien levante el teléfono.
 */
async function applyStatuses(value: WhatsAppValue): Promise<void> {
  for (const status of value.statuses ?? []) {
    if (status.status !== 'failed' || !status.id) continue;
    await prisma.outboundMessage.updateMany({
      where: { providerMessageId: status.id },
      data: {
        status: 'FAILED',
        lastError: status.errors?.[0]?.title ?? 'WhatsApp reportó una entrega fallida',
      },
    });
  }
}
