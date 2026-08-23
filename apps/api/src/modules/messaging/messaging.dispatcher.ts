import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import { dispatchPending } from './messaging.service.js';

/**
 * Proceso de fondo que vacía la cola de avisos.
 *
 * Va dentro del mismo proceso de la API a propósito: para el volumen de una
 * pizzería, un worker aparte sería infraestructura de más. Si algún día hay
 * varias instancias, esto se mueve a un proceso único sin tocar el resto,
 * porque la cola ya vive en la base.
 */

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  // Evita que dos vueltas se pisen si un envío tarda más que el intervalo.
  if (running) return;
  running = true;

  try {
    const result = await dispatchPending();
    if (result.sent > 0 || result.failed > 0) {
      logger.debug(result, 'Avisos procesados');
    }
  } catch (err) {
    logger.error({ err }, 'Falló el procesamiento de la cola de avisos');
  } finally {
    running = false;
  }
}

export function startMessagingDispatcher(): void {
  if (timer) return;

  timer = setInterval(() => void tick(), env.MESSAGING_DISPATCH_INTERVAL_MS);
  // No debe mantener vivo el proceso durante un apagado ordenado.
  timer.unref();

  logger.info(
    `Cola de avisos activa (cada ${env.MESSAGING_DISPATCH_INTERVAL_MS / 1000}s, proveedor: ${env.WHATSAPP_PROVIDER})`,
  );
}

export function stopMessagingDispatcher(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
