import type { CategoryDto, CreateCategoryInput, UpdateCategoryInput } from '@autoelite/shared';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '../../http/context.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { toCategoryDto } from './catalog.mapper.js';

export async function listCategories(
  ctx: TenantContext,
  includeInactive = false,
): Promise<CategoryDto[]> {
  const categories = await ctx.db.category.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { products: { where: { deletedAt: null } } } } },
  });
  return categories.map((c) => toCategoryDto(c, c._count.products));
}

async function findOrThrow(ctx: TenantContext, publicId: string) {
  const category = await ctx.db.category.findFirst({ where: { publicId } });
  if (!category) throw new NotFoundError('La categoría no existe');
  return category;
}

export async function createCategory(
  ctx: TenantContext,
  input: CreateCategoryInput,
): Promise<CategoryDto> {
  try {
    return toCategoryDto(
      await ctx.db.category.create({ data: { ...input, commerceId: ctx.commerceId } }),
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('CONFLICT', 'Ya existe una categoría con ese nombre');
    }
    throw err;
  }
}

export async function updateCategory(
  ctx: TenantContext,
  publicId: string,
  input: UpdateCategoryInput,
): Promise<CategoryDto> {
  const category = await findOrThrow(ctx, publicId);
  try {
    return toCategoryDto(await ctx.db.category.update({ where: { id: category.id }, data: input }));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('CONFLICT', 'Ya existe una categoría con ese nombre');
    }
    throw err;
  }
}

/**
 * Se desactiva en vez de borrar: una categoría borrada dejaría productos
 * huérfanos y rompería los pedidos históricos que la referencian.
 */
export async function deactivateCategory(
  ctx: TenantContext,
  publicId: string,
): Promise<CategoryDto> {
  const category = await findOrThrow(ctx, publicId);
  return toCategoryDto(
    await ctx.db.category.update({ where: { id: category.id }, data: { isActive: false } }),
  );
}
