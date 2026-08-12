import { Router } from 'express';
import { apiClientsRouter } from '../modules/api-clients/api-clients.routes.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { commercesRouter } from '../modules/commerces/commerces.routes.js';
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
