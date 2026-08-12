import { env } from '../config/env.js';
import { disconnectPrisma } from '../db/prisma.js';
import { logger } from '../shared/logger.js';
import { createApp } from './app.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`API escuchando en http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

/**
 * Apagado ordenado: se deja de aceptar conexiones, se esperan las que están en
 * curso y recién ahí se cierra la base. Sin esto, un deploy corta pedidos a
 * medio guardar.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} recibido, cerrando`);

  const forced = setTimeout(() => {
    logger.error('El cierre ordenado tardó demasiado, saliendo por la fuerza');
    process.exit(1);
  }, 10_000);
  forced.unref();

  server.close(async (err) => {
    if (err) logger.error({ err }, 'Error al cerrar el servidor HTTP');
    await disconnectPrisma();
    clearTimeout(forced);
    process.exit(err ? 1 : 0);
  });
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void shutdown(signal));
}

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Promesa rechazada sin manejar');
});
