import {
  createCategorySchema,
  createModifierGroupSchema,
  createProductSchema,
  productFiltersSchema,
  updateCategorySchema,
  updateProductSchema,
} from '@autoelite/shared';
import { Router } from 'express';
import { z } from 'zod';
import { getTenantContext } from '../../http/context.js';
import { requireRole } from '../../http/middlewares/authorize.js';
import { validate, validatedQuery } from '../../http/middlewares/validate.js';
import * as categories from './categories.service.js';
import * as modifiers from './modifiers.service.js';
import * as products from './products.service.js';

const idParams = z.object({ id: z.string().min(1).max(64) });
type IdParams = z.infer<typeof idParams>;

/** Cambiar precios y catálogo no es tarea del personal de mostrador. */
const canEditCatalog = requireRole('OWNER', 'MANAGER');

// ---------- Categorías ----------

export const categoriesRouter: Router = Router();

categoriesRouter.get(
  '/',
  validate({ query: z.object({ includeInactive: z.enum(['true', 'false']).optional() }) }),
  async (req, res) => {
    const { includeInactive } = req.query as { includeInactive?: string };
    res.json({ data: await categories.listCategories(getTenantContext(req), includeInactive === 'true') });
  },
);

categoriesRouter.post('/', canEditCatalog, validate({ body: createCategorySchema }), async (req, res) => {
  res.status(201).json(await categories.createCategory(getTenantContext(req), req.body));
});

categoriesRouter.patch<IdParams>(
  '/:id',
  canEditCatalog,
  validate({ params: idParams, body: updateCategorySchema }),
  async (req, res) => {
    res.json(await categories.updateCategory(getTenantContext(req), req.params.id, req.body));
  },
);

categoriesRouter.delete<IdParams>(
  '/:id',
  canEditCatalog,
  validate({ params: idParams }),
  async (req, res) => {
    res.json(await categories.deactivateCategory(getTenantContext(req), req.params.id));
  },
);

// ---------- Productos ----------

export const productsRouter: Router = Router();

productsRouter.get('/', validate({ query: productFiltersSchema }), async (req, res) => {
  const filters = validatedQuery(req, productFiltersSchema);
  res.json({ data: await products.listProducts(getTenantContext(req), filters) });
});

productsRouter.post('/', canEditCatalog, validate({ body: createProductSchema }), async (req, res) => {
  res.status(201).json(await products.createProduct(getTenantContext(req), req.body));
});

productsRouter.get<IdParams>('/:id', validate({ params: idParams }), async (req, res) => {
  res.json(await products.getProduct(getTenantContext(req), req.params.id));
});

productsRouter.patch<IdParams>(
  '/:id',
  canEditCatalog,
  validate({ params: idParams, body: updateProductSchema }),
  async (req, res) => {
    res.json(await products.updateProduct(getTenantContext(req), req.params.id, req.body));
  },
);

// Disponible para todo el personal: cortar un producto durante el servicio no
// puede depender de que esté el encargado.
productsRouter.patch<IdParams>(
  '/:id/availability',
  validate({ params: idParams, body: z.object({ isAvailable: z.boolean() }) }),
  async (req, res) => {
    const { isAvailable } = req.body as { isAvailable: boolean };
    res.json(await products.setProductAvailability(getTenantContext(req), req.params.id, isAvailable));
  },
);

productsRouter.delete<IdParams>(
  '/:id',
  canEditCatalog,
  validate({ params: idParams }),
  async (req, res) => {
    await products.deleteProduct(getTenantContext(req), req.params.id);
    res.status(204).send();
  },
);

// ---------- Modificadores ----------

export const modifierGroupsRouter: Router = Router();

modifierGroupsRouter.get('/', async (req, res) => {
  res.json({ data: await modifiers.listModifierGroups(getTenantContext(req)) });
});

modifierGroupsRouter.post(
  '/',
  canEditCatalog,
  validate({ body: createModifierGroupSchema }),
  async (req, res) => {
    res.status(201).json(await modifiers.createModifierGroup(getTenantContext(req), req.body));
  },
);

modifierGroupsRouter.delete<IdParams>(
  '/:id',
  canEditCatalog,
  validate({ params: idParams }),
  async (req, res) => {
    res.json(await modifiers.deactivateModifierGroup(getTenantContext(req), req.params.id));
  },
);
