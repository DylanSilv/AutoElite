import { createUserSchema, cursorPaginationSchema, updateUserSchema } from '@autoelite/shared';
import { Router } from 'express';
import { z } from 'zod';
import { getTenantContext } from '../../http/context.js';
import { requireRole } from '../../http/middlewares/authorize.js';
import { validate, validatedQuery } from '../../http/middlewares/validate.js';
import * as service from './users.service.js';

const publicIdParams = z.object({ id: z.string().min(1).max(64) });
type PublicIdParams = z.infer<typeof publicIdParams>;

export const usersRouter: Router = Router();

// El personal no administra personal: sólo dueño y encargados.
usersRouter.use(requireRole('OWNER', 'MANAGER'));

usersRouter.get('/', validate({ query: cursorPaginationSchema }), async (req, res) => {
  const { limit, cursor } = validatedQuery(req, cursorPaginationSchema);
  res.json(await service.listUsers(getTenantContext(req), { limit, cursor }));
});

usersRouter.post('/', validate({ body: createUserSchema }), async (req, res) => {
  res.status(201).json(await service.createUser(getTenantContext(req), req.body));
});

usersRouter.get<PublicIdParams>('/:id', validate({ params: publicIdParams }), async (req, res) => {
  res.json(await service.getUser(getTenantContext(req), req.params.id));
});

usersRouter.patch<PublicIdParams>(
  '/:id',
  validate({ params: publicIdParams, body: updateUserSchema }),
  async (req, res) => {
    res.json(await service.updateUser(getTenantContext(req), req.params.id, req.body));
  },
);
