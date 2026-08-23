import { PrismaClient } from '@prisma/client';
import { env, isProduction } from '../config/env.js';
import { logger } from '../shared/logger.js';

export const prisma = new PrismaClient({
  log: isProduction ? ['warn', 'error'] : ['warn', 'error'],
  datasources: { db: { url: env.DATABASE_URL } },
});

export type PrismaClientLike = typeof prisma;

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  logger.debug('Conexión a la base cerrada');
}
