import {
  cancelOrderSchema,
  changeStatusSchema,
  createOrderSchema,
  cursorPaginationSchema,
  orderFiltersSchema,
  quoteOrderSchema,
  rejectPaymentSchema,
  reviewPaymentSchema,
  submitPaymentProofSchema,
} from '@autoelite/shared';
import { Router } from 'express';
import { z } from 'zod';
import { getTenantContext } from '../../http/context.js';
import { validate, validatedQuery } from '../../http/middlewares/validate.js';
import * as service from './orders.service.js';

const idParams = z.object({ id: z.string().min(1).max(64) });
type IdParams = z.infer<typeof idParams>;

const listQuery = cursorPaginationSchema.merge(orderFiltersSchema);

export const ordersRouter: Router = Router();

/**
 * Calcula totales sin persistir nada.
 *
 * Lo usan el panel (para mostrar el total en vivo mientras se carga el pedido)
 * y, en la fase 2, el agente antes de confirmar. Así el número que ve el
 * cliente es el mismo que va a guardar el backend.
 */
ordersRouter.post('/quote', validate({ body: quoteOrderSchema }), async (req, res) => {
  res.json(await service.quoteOrder(getTenantContext(req), req.body));
});

ordersRouter.post('/', validate({ body: createOrderSchema }), async (req, res) => {
  // Header estándar: si n8n reintenta un paso que falló por timeout, no se
  // duplica el pedido.
  const idempotencyKey = req.get('idempotency-key')?.slice(0, 100);
  res.status(201).json(await service.createOrder(getTenantContext(req), req.body, idempotencyKey));
});

/** Vista operativa del día, agrupada por estado. */
ordersRouter.get('/board', async (req, res) => {
  res.json(await service.getBoard(getTenantContext(req)));
});

ordersRouter.get('/', validate({ query: listQuery }), async (req, res) => {
  const params = validatedQuery(req, listQuery);
  res.json(await service.listOrders(getTenantContext(req), params));
});

ordersRouter.get<IdParams>('/:id', validate({ params: idParams }), async (req, res) => {
  res.json(await service.getOrder(getTenantContext(req), req.params.id));
});

ordersRouter.post<IdParams>(
  '/:id/status',
  validate({ params: idParams, body: changeStatusSchema }),
  async (req, res) => {
    res.json(await service.changeStatus(getTenantContext(req), req.params.id, req.body));
  },
);

/**
 * Comprobante que manda el cliente.
 *
 * Lo usa el agente al recibir la imagen por WhatsApp, y también puede cargarlo
 * el personal si el cliente lo mandó por otro lado.
 */
ordersRouter.post<IdParams>(
  '/:id/payment/proof',
  validate({ params: idParams, body: submitPaymentProofSchema }),
  async (req, res) => {
    res.json(await service.submitProof(getTenantContext(req), req.params.id, req.body));
  },
);

// Confirmar y rechazar exigen una persona: la validación está en el servicio,
// porque es una regla del negocio y no del transporte.
ordersRouter.post<IdParams>(
  '/:id/payment/confirm',
  validate({ params: idParams, body: reviewPaymentSchema }),
  async (req, res) => {
    res.json(await service.approvePayment(getTenantContext(req), req.params.id, req.body));
  },
);

ordersRouter.post<IdParams>(
  '/:id/payment/reject',
  validate({ params: idParams, body: rejectPaymentSchema }),
  async (req, res) => {
    res.json(await service.declinePayment(getTenantContext(req), req.params.id, req.body));
  },
);

ordersRouter.post<IdParams>(
  '/:id/cancel',
  validate({ params: idParams, body: cancelOrderSchema }),
  async (req, res) => {
    res.json(await service.cancelOrder(getTenantContext(req), req.params.id, req.body));
  },
);
