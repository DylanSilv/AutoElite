import type {
  CreateProductInput,
  ProductDto,
  ProductFilters,
  UpdateProductInput,
  VariantInput,
} from '@autoelite/shared';
import type { TenantContext } from '../../http/context.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { productInclude, toProductDto } from './catalog.mapper.js';

async function resolveCategoryId(ctx: TenantContext, publicId: string): Promise<number> {
  const category = await ctx.db.category.findFirst({ where: { publicId } });
  if (!category) throw new ValidationError('La categoría indicada no existe');
  return category.id;
}

async function resolveModifierGroupIds(
  ctx: TenantContext,
  publicIds: string[],
): Promise<number[]> {
  if (publicIds.length === 0) return [];
  const groups = await ctx.db.modifierGroup.findMany({ where: { publicId: { in: publicIds } } });
  if (groups.length !== publicIds.length) {
    throw new ValidationError('Alguno de los grupos de modificadores no existe');
  }
  return groups.map((g) => g.id);
}

export async function listProducts(
  ctx: TenantContext,
  filters: ProductFilters,
): Promise<ProductDto[]> {
  const products = await ctx.db.product.findMany({
    where: {
      deletedAt: null,
      ...(filters.onlyAvailable ? { isAvailable: true } : {}),
      ...(filters.search ? { name: { contains: filters.search } } : {}),
      ...(filters.categoryId ? { category: { publicId: filters.categoryId } } : {}),
    },
    // Primero por categoría y después por posición dentro de ella: si se
    // ordenara sólo por sortOrder, el listado mezclaría pizzas con postres.
    orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
    include: productInclude,
  });
  return products.map(toProductDto);
}

async function findOrThrow(ctx: TenantContext, publicId: string) {
  const product = await ctx.db.product.findFirst({
    where: { publicId, deletedAt: null },
    include: productInclude,
  });
  if (!product) throw new NotFoundError('El producto no existe');
  return product;
}

export async function getProduct(ctx: TenantContext, publicId: string): Promise<ProductDto> {
  return toProductDto(await findOrThrow(ctx, publicId));
}

export async function createProduct(
  ctx: TenantContext,
  input: CreateProductInput,
): Promise<ProductDto> {
  const categoryId = await resolveCategoryId(ctx, input.categoryId);
  const groupIds = await resolveModifierGroupIds(ctx, input.modifierGroupIds);

  const product = await ctx.db.product.create({
    data: {
      commerceId: ctx.commerceId,
      categoryId,
      name: input.name,
      description: input.description ?? null,
      imageUrl: input.imageUrl ?? null,
      isAvailable: input.isAvailable,
      sortOrder: input.sortOrder,
      variants: {
        // El commerceId va explícito: la extensión de aislamiento no alcanza
        // las escrituras anidadas (ver db/tenant.ts).
        create: input.variants.map((v, index) => ({
          commerceId: ctx.commerceId,
          name: v.name,
          priceCents: v.priceCents,
          isAvailable: v.isAvailable,
          sortOrder: v.sortOrder || index,
        })),
      },
      modifierGroups: {
        create: groupIds.map((modifierGroupId, index) => ({ modifierGroupId, sortOrder: index })),
      },
    },
    include: productInclude,
  });

  return toProductDto(product);
}

/**
 * Sincroniza las variantes contra lo que manda el panel.
 *
 * Las que desaparecen se marcan borradas en vez de eliminarse: los pedidos
 * históricos las referencian, y un pedido de hace tres meses tiene que seguir
 * leyéndose.
 */
async function syncVariants(
  ctx: TenantContext,
  productId: number,
  variants: VariantInput[],
): Promise<void> {
  const existing = await ctx.db.productVariant.findMany({
    where: { productId, deletedAt: null },
  });

  const keptIds = new Set(variants.map((v) => v.id).filter(Boolean));

  for (const variant of existing) {
    if (!keptIds.has(variant.publicId)) {
      await ctx.db.productVariant.update({
        where: { id: variant.id },
        data: { deletedAt: new Date(), isAvailable: false },
      });
    }
  }

  for (const [index, input] of variants.entries()) {
    const match = input.id ? existing.find((v) => v.publicId === input.id) : undefined;
    if (match) {
      await ctx.db.productVariant.update({
        where: { id: match.id },
        data: {
          name: input.name,
          priceCents: input.priceCents,
          isAvailable: input.isAvailable,
          sortOrder: input.sortOrder || index,
        },
      });
    } else {
      await ctx.db.productVariant.create({
        data: {
          commerceId: ctx.commerceId,
          productId,
          name: input.name,
          priceCents: input.priceCents,
          isAvailable: input.isAvailable,
          sortOrder: input.sortOrder || index,
        },
      });
    }
  }
}

export async function updateProduct(
  ctx: TenantContext,
  publicId: string,
  input: UpdateProductInput,
): Promise<ProductDto> {
  const product = await findOrThrow(ctx, publicId);

  const categoryId = input.categoryId ? await resolveCategoryId(ctx, input.categoryId) : undefined;

  await ctx.db.product.update({
    where: { id: product.id },
    data: {
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }),
      ...(input.isAvailable === undefined ? {} : { isAvailable: input.isAvailable }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
    },
  });

  if (input.variants) await syncVariants(ctx, product.id, input.variants);

  if (input.modifierGroupIds) {
    const groupIds = await resolveModifierGroupIds(ctx, input.modifierGroupIds);
    await ctx.db.productModifierGroup.deleteMany({ where: { productId: product.id } });
    for (const [index, modifierGroupId] of groupIds.entries()) {
      await ctx.db.productModifierGroup.create({
        data: { productId: product.id, modifierGroupId, sortOrder: index },
      });
    }
  }

  return toProductDto(await findOrThrow(ctx, publicId));
}

/**
 * Cortar un producto en un toque.
 *
 * "Se acabó la muzzarella" pasa a las diez de la noche y tiene que resolverse
 * desde el celular sin abrir un formulario.
 */
export async function setProductAvailability(
  ctx: TenantContext,
  publicId: string,
  isAvailable: boolean,
): Promise<ProductDto> {
  const product = await findOrThrow(ctx, publicId);
  await ctx.db.product.update({ where: { id: product.id }, data: { isAvailable } });
  return toProductDto(await findOrThrow(ctx, publicId));
}

export async function deleteProduct(ctx: TenantContext, publicId: string): Promise<void> {
  const product = await findOrThrow(ctx, publicId);
  await ctx.db.product.update({
    where: { id: product.id },
    data: { deletedAt: new Date(), isAvailable: false },
  });
}
