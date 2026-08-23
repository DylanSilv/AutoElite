import { Router } from 'express';
import { z } from 'zod';
import { getTenantContext } from '../../http/context.js';
import { validate } from '../../http/middlewares/validate.js';
import * as service from './reports.service.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado YYYY-MM-DD');

const rangeQuery = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

export const reportsRouter: Router = Router();

// Sin rango, el dashboard muestra el día operativo en curso.
reportsRouter.get('/dashboard', validate({ query: rangeQuery }), async (req, res) => {
  const { from, to } = req.query as { from?: string; to?: string };
  res.json(await service.getDashboard(getTenantContext(req), { from, to }));
});
