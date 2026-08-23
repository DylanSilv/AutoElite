import { createApiClientSchema } from '@autoelite/shared';
import { Router } from 'express';
import { z } from 'zod';
import { getTenantContext } from '../../http/context.js';
import { requireRole } from '../../http/middlewares/authorize.js';
import { validate } from '../../http/middlewares/validate.js';
import * as service from './api-clients.service.js';

const publicIdParams = z.object({ id: z.string().min(1).max(64) });
type PublicIdParams = z.infer<typeof publicIdParams>;

export const apiClientsRouter: Router = Router();

// Emitir credenciales para n8n o el agente es una decisión del dueño.
apiClientsRouter.use(requireRole('OWNER'));

apiClientsRouter.get('/', async (req, res) => {
  res.json({ data: await service.listApiClients(getTenantContext(req)) });
});

apiClientsRouter.post('/', validate({ body: createApiClientSchema }), async (req, res) => {
  res.status(201).json(await service.createApiClient(getTenantContext(req), req.body));
});

apiClientsRouter.post<PublicIdParams>(
  '/:id/revoke',
  validate({ params: publicIdParams }),
  async (req, res) => {
    res.json(await service.revokeApiClient(getTenantContext(req), req.params.id));
  },
);
