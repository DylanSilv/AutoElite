import {
  CONVERSATION_STATUSES,
  handoffSchema,
  inboundMessageSchema,
  staffReplySchema,
} from '@autoelite/shared';
import { Router } from 'express';
import { z } from 'zod';
import { getTenantContext } from '../../http/context.js';
import { requireScope, requireUser } from '../../http/middlewares/authorize.js';
import { validate } from '../../http/middlewares/validate.js';
import * as service from './agent.service.js';

/**
 * API del asistente para clientes autenticados.
 *
 * `POST /agent/messages` es la puerta genérica: la usa el simulador del panel y
 * la puede usar cualquier integración —n8n, otro canal, una prueba— con una API
 * key. El webhook de WhatsApp entra por otro lado porque Meta no puede
 * autenticarse con nuestras credenciales, pero termina llamando al mismo
 * service.
 */

const idParams = z.object({ id: z.string().min(1).max(64) });
type IdParams = z.infer<typeof idParams>;

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
});

export const agentRouter: Router = Router();

agentRouter.post(
  '/messages',
  requireScope('orders:write'),
  validate({ body: inboundMessageSchema }),
  async (req, res) => {
    res.json(await service.handleInboundMessage(getTenantContext(req), req.body));
  },
);

agentRouter.get('/conversations', validate({ query: listQuery }), async (req, res) => {
  const params = req.query as unknown as z.infer<typeof listQuery>;
  res.json(await service.listConversations(getTenantContext(req), params));
});

agentRouter.get<IdParams>(
  '/conversations/:id',
  validate({ params: idParams }),
  async (req, res) => {
    res.json(await service.getConversation(getTenantContext(req), req.params.id));
  },
);

agentRouter.post<IdParams>(
  '/conversations/:id/handoff',
  requireUser,
  validate({ params: idParams, body: handoffSchema }),
  async (req, res) => {
    res.json(await service.handOff(getTenantContext(req), req.params.id, req.body.reason));
  },
);

agentRouter.post<IdParams>(
  '/conversations/:id/resume',
  requireUser,
  validate({ params: idParams }),
  async (req, res) => {
    res.json(await service.resumeBot(getTenantContext(req), req.params.id));
  },
);

agentRouter.post<IdParams>(
  '/conversations/:id/reply',
  requireUser,
  validate({ params: idParams, body: staffReplySchema }),
  async (req, res) => {
    res.json(await service.sendStaffReply(getTenantContext(req), req.params.id, req.body.text));
  },
);
