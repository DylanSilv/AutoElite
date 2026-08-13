import { env } from '../config/env.js';
import { disconnectPrisma, prisma } from '../db/prisma.js';
import { logger } from '../shared/logger.js';
import { createApp } from './app.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`API escuchando en http://localhost:${env.PORT} (${env.NODE_ENV})`);
  void checkDatabase();
});

/**
 * Chequeo de conectividad al arrancar.
 *
 * No impide levantar —el endpoint de salud tiene que poder responder aunque la
 * base esté caída—, pero avisa de entrada en vez de dejar que el problema
 * aparezca recién cuando alguien intenta entrar al panel.
 */
async function checkDatabase(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Conexión con la base de datos verificada');
  } catch {
    // El host y el puerto son el dato que hace falta; la contraseña no se loguea.
    const target = env.DATABASE_URL.replace(/\/\/[^@]*@/, '//***@');
    logger.error(
      `No se pudo conectar a la base de datos (${target}). ` +
        'Verificá que esté levantada (pnpm db:up) y que DATABASE_URL apunte al puerto correcto.',
    );
  }
}

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
