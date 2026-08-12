import { changePasswordSchema, loginSchema } from '@autoelite/shared';
import { Router } from 'express';
import { authenticate } from '../../http/middlewares/authenticate.js';
import { requireUser } from '../../http/middlewares/authorize.js';
import { loginRateLimit } from '../../http/middlewares/rate-limit.js';
import { validate } from '../../http/middlewares/validate.js';
import * as controller from './auth.controller.js';

export const authRouter: Router = Router();

authRouter.post('/login', loginRateLimit, validate({ body: loginSchema }), controller.login);
authRouter.post('/refresh', controller.refresh);
authRouter.post('/logout', controller.logout);

authRouter.get('/me', authenticate, controller.me);
authRouter.post(
  '/change-password',
  authenticate,
  requireUser,
  validate({ body: changePasswordSchema }),
  controller.changePassword,
);
