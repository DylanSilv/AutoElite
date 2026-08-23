import { updateCommerceSchema } from '@autoelite/shared';
import { Router } from 'express';
import { getTenantContext } from '../../http/context.js';
import { requireRole } from '../../http/middlewares/authorize.js';
import { validate } from '../../http/middlewares/validate.js';
import * as service from './commerces.service.js';

export const commercesRouter: Router = Router();

// Todo el personal necesita leer la configuración (zona horaria, moneda);
// modificarla es del dueño.
commercesRouter.get('/', async (req, res) => {
  res.json(await service.getOwnCommerce(getTenantContext(req)));
});

commercesRouter.patch(
  '/',
  requireRole('OWNER'),
  validate({ body: updateCommerceSchema }),
  async (req, res) => {
    res.json(await service.updateOwnCommerce(getTenantContext(req), req.body));
  },
);
