import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';

/**
 * Proveedor de mensajería saliente.
 *
 * La interfaz es deliberadamente mínima para que cambiar de WhatsApp Cloud API
 * a otro proveedor —o a un intermediario como n8n— no toque nada del dominio.
 * El resto del sistema sólo sabe que existe "una forma de mandar un mensaje".
 */
export interface MessagingProvider {
  readonly name: string;
  sendText(to: string, body: string): Promise<{ providerMessageId: string }>;
}

/** Error del proveedor que no tiene sentido reintentar (número inválido, permisos). */
export class PermanentSendError extends Error {}

/**
 * Proveedor de desarrollo: registra el mensaje en el log en vez de enviarlo.
 *
 * Permite probar todo el flujo —incluida la pantalla del panel— sin credenciales
 * de Meta ni gastar conversaciones.
 */
export class LogMessagingProvider implements MessagingProvider {
  readonly name = 'log';

  async sendText(to: string, body: string): Promise<{ providerMessageId: string }> {
    logger.info({ to, body }, '[WhatsApp simulado] mensaje que se habría enviado');
    return { providerMessageId: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  }
}

/**
 * WhatsApp Business Cloud API (Meta).
 *
 * Sólo envía texto libre, que es lo que corresponde dentro de la ventana de 24
 * horas posterior al último mensaje del cliente. Fuera de esa ventana Meta
 * exige una plantilla aprobada; quien decide si hay ventana es el servicio, no
 * el proveedor.
 */
export class WhatsAppCloudProvider implements MessagingProvider {
  readonly name = 'whatsapp-cloud';

  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly apiVersion: string,
  ) {}

  async sendText(to: string, body: string): Promise<{ providerMessageId: string }> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        // Meta espera el número sin el "+".
        to: to.replace(/^\+/, ''),
        type: 'text',
        text: { preview_url: false, body },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      // 4xx son problemas del mensaje o de la configuración: reintentar sólo
      // gastaría cuota. 5xx sí pueden ser transitorios.
      if (response.status >= 400 && response.status < 500) {
        throw new PermanentSendError(`WhatsApp rechazó el mensaje (${response.status}): ${detail}`);
      }
      throw new Error(`Error de WhatsApp (${response.status}): ${detail}`);
    }

    const payload = (await response.json()) as { messages?: { id: string }[] };
    const id = payload.messages?.[0]?.id;
    if (!id) throw new Error('WhatsApp no devolvió el identificador del mensaje');

    return { providerMessageId: id };
  }
}

let provider: MessagingProvider | null = null;

/** Elige el proveedor según la configuración. Sin credenciales, se simula. */
export function getMessagingProvider(): MessagingProvider {
  if (provider) return provider;

  if (
    env.WHATSAPP_PROVIDER === 'cloud' &&
    env.WHATSAPP_PHONE_NUMBER_ID &&
    env.WHATSAPP_ACCESS_TOKEN
  ) {
    provider = new WhatsAppCloudProvider(
      env.WHATSAPP_PHONE_NUMBER_ID,
      env.WHATSAPP_ACCESS_TOKEN,
      env.WHATSAPP_API_VERSION,
    );
  } else {
    if (env.WHATSAPP_PROVIDER === 'cloud') {
      logger.warn(
        'WHATSAPP_PROVIDER=cloud pero faltan credenciales: los mensajes se simulan en el log.',
      );
    }
    provider = new LogMessagingProvider();
  }

  return provider;
}

/** Sólo para tests: permite inyectar un proveedor y observar los envíos. */
export function setMessagingProvider(next: MessagingProvider | null): void {
  provider = next;
}
