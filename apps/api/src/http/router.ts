import { Router } from 'express';
import { apiClientsRouter } from '../modules/api-clients/api-clients.routes.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import {
  categoriesRouter,
  modifierGroupsRouter,
  productsRouter,
} from '../modules/catalog/catalog.routes.js';
import { commercesRouter } from '../modules/commerces/commerces.routes.js';
import { deliveryZonesRouter, paymentMethodsRouter } from '../modules/config/config.routes.js';
import { customersRouter } from '../modules/customers/customers.routes.js';
import { ordersRouter } from '../modules/orders/orders.routes.js';
import { reportsRouter } from '../modules/reports/reports.routes.js';
import { usersRouter } from '../modules/users/users.routes.js';
import { authenticate } from './middlewares/authenticate.js';
import { apiRateLimit } from './middlewares/rate-limit.js';

/**
 * Contrato versionado en /api/v1. Lo consumen indistintamente el panel web,
 * n8n y el agente de IA: no hay endpoints "para n8n", hay endpoints.
 */
export const apiRouter: Router = Router();

apiRouter.use('/auth', authRouter);

// A partir de acá, todo exige credenciales.
apiRouter.use(authenticate, apiRateLimit);

apiRouter.use('/commerce', commercesRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/api-clients', apiClientsRouter);

apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/products', productsRouter);
apiRouter.use('/modifier-groups', modifierGroupsRouter);

apiRouter.use('/customers', customersRouter);
apiRouter.use('/delivery-zones', deliveryZonesRouter);
apiRouter.use('/payment-methods', paymentMethodsRouter);

apiRouter.use('/orders', ordersRouter);
apiRouter.use('/reports', reportsRouter);
