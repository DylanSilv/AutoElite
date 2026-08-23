import { createPromotionSchema, updatePromotionSchema } from '@autoelite/shared';
import { Router } from 'express';
import { z } from 'zod';
import { getTenantContext } from '../../http/context.js';
import { requireRole } from '../../http/middlewares/authorize.js';
import { validate } from '../../http/middlewares/validate.js';
import * as service from './promotions.service.js';

const idParams = z.object({ id: z.string().min(1).max(64) });
type IdParams = z.infer<typeof idParams>;
const includeInactiveQuery = z.object({ includeInactive: z.enum(['true', 'false']).optional() });

const canConfigure = requireRole('OWNER', 'MANAGER');

export const promotionsRouter: Router = Router();

promotionsRouter.get('/', validate({ query: includeInactiveQuery }), async (req, res) => {
  const { includeInactive } = req.query as { includeInactive?: string };
  res.json({
    data: await service.listPromotions(getTenantContext(req), includeInactive === 'true'),
  });
});

promotionsRouter.post('/', canConfigure, validate({ body: createPromotionSchema }), async (req, res) => {
  res.status(201).json(await service.createPromotion(getTenantContext(req), req.body));
});

promotionsRouter.patch<IdParams>(
  '/:id',
  canConfigure,
  validate({ params: idParams, body: updatePromotionSchema }),
  async (req, res) => {
    res.json(await service.updatePromotion(getTenantContext(req), req.params.id, req.body));
  },
);

promotionsRouter.delete<IdParams>(
  '/:id',
  canConfigure,
  validate({ params: idParams }),
  async (req, res) => {
    await service.deletePromotion(getTenantContext(req), req.params.id);
    res.status(204).end();
  },
);
