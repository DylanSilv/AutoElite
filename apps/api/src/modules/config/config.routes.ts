import {
  createDeliveryZoneSchema,
  createPaymentMethodSchema,
  updateDeliveryZoneSchema,
  updatePaymentMethodSchema,
} from '@autoelite/shared';
import { Router } from 'express';
import { z } from 'zod';
import { getTenantContext } from '../../http/context.js';
import { requireRole } from '../../http/middlewares/authorize.js';
import { validate } from '../../http/middlewares/validate.js';
import * as service from './config.service.js';

const idParams = z.object({ id: z.string().min(1).max(64) });
type IdParams = z.infer<typeof idParams>;
const includeInactiveQuery = z.object({ includeInactive: z.enum(['true', 'false']).optional() });

const canConfigure = requireRole('OWNER', 'MANAGER');

export const deliveryZonesRouter: Router = Router();

deliveryZonesRouter.get('/', validate({ query: includeInactiveQuery }), async (req, res) => {
  const { includeInactive } = req.query as { includeInactive?: string };
  res.json({
    data: await service.listDeliveryZones(getTenantContext(req), includeInactive === 'true'),
  });
});

deliveryZonesRouter.post(
  '/',
  canConfigure,
  validate({ body: createDeliveryZoneSchema }),
  async (req, res) => {
    res.status(201).json(await service.createDeliveryZone(getTenantContext(req), req.body));
  },
);

deliveryZonesRouter.patch<IdParams>(
  '/:id',
  canConfigure,
  validate({ params: idParams, body: updateDeliveryZoneSchema }),
  async (req, res) => {
    res.json(await service.updateDeliveryZone(getTenantContext(req), req.params.id, req.body));
  },
);

export const paymentMethodsRouter: Router = Router();

paymentMethodsRouter.get('/', validate({ query: includeInactiveQuery }), async (req, res) => {
  const { includeInactive } = req.query as { includeInactive?: string };
  res.json({
    data: await service.listPaymentMethods(getTenantContext(req), includeInactive === 'true'),
  });
});

paymentMethodsRouter.post(
  '/',
  canConfigure,
  validate({ body: createPaymentMethodSchema }),
  async (req, res) => {
    res.status(201).json(await service.createPaymentMethod(getTenantContext(req), req.body));
  },
);

paymentMethodsRouter.patch<IdParams>(
  '/:id',
  canConfigure,
  validate({ params: idParams, body: updatePaymentMethodSchema }),
  async (req, res) => {
    res.json(await service.updatePaymentMethod(getTenantContext(req), req.params.id, req.body));
  },
);
