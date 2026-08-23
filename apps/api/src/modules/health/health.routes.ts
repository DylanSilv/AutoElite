import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../shared/logger.js';

export const healthRouter: Router = Router();

/** Liveness: el proceso responde. No toca la base a propósito. */
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

/** Readiness: además hay base. Es lo que mira el orquestador antes de enrutar. */
healthRouter.get('/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch (err) {
    logger.error({ err }, 'La base no responde');
    res.status(503).json({ status: 'unavailable' });
  }
});
