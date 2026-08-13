import {
  createCustomerSchema,
  cursorPaginationSchema,
  customerFiltersSchema,
  updateCustomerSchema,
} from '@autoelite/shared';
import { Router } from 'express';
import { z } from 'zod';
import { getTenantContext } from '../../http/context.js';
import { validate, validatedQuery } from '../../http/middlewares/validate.js';
import * as service from './customers.service.js';

const idParams = z.object({ id: z.string().min(1).max(64) });
type IdParams = z.infer<typeof idParams>;

const listQuery = cursorPaginationSchema.merge(customerFiltersSchema);

export const customersRouter: Router = Router();

customersRouter.get('/', validate({ query: listQuery }), async (req, res) => {
  const params = validatedQuery(req, listQuery);
  res.json(await service.listCustomers(getTenantContext(req), params));
});

// Búsqueda exacta por teléfono. Es la que va a usar la herramienta
// `buscar_cliente()` del agente en la fase 2, y también el buscador del panel
// al cargar un pedido.
customersRouter.get(
  '/by-phone',
  validate({ query: z.object({ phone: z.string().min(4).max(30) }) }),
  async (req, res) => {
    const { phone } = req.query as { phone: string };
    const customer = await service.findByPhone(getTenantContext(req), phone);
    res.json({ data: customer });
  },
);

customersRouter.post('/', validate({ body: createCustomerSchema }), async (req, res) => {
  res.status(201).json(await service.createCustomer(getTenantContext(req), req.body));
});

customersRouter.get<IdParams>('/:id', validate({ params: idParams }), async (req, res) => {
  res.json(await service.getCustomer(getTenantContext(req), req.params.id));
});

customersRouter.patch<IdParams>(
  '/:id',
  validate({ params: idParams, body: updateCustomerSchema }),
  async (req, res) => {
    res.json(await service.updateCustomer(getTenantContext(req), req.params.id, req.body));
  },
);
