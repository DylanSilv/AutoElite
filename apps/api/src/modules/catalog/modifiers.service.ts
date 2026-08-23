import type { CreateModifierGroupInput, ModifierGroupDto } from '@autoelite/shared';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '../../http/context.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { toModifierGroupDto } from './catalog.mapper.js';

export async function listModifierGroups(ctx: TenantContext): Promise<ModifierGroupDto[]> {
  const groups = await ctx.db.modifierGroup.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { options: true },
  });
  return groups.map(toModifierGroupDto);
}

export async function createModifierGroup(
  ctx: TenantContext,
  input: CreateModifierGroupInput,
): Promise<ModifierGroupDto> {
  try {
    const group = await ctx.db.modifierGroup.create({
      data: {
        commerceId: ctx.commerceId,
        name: input.name,
        minSelect: input.minSelect,
        maxSelect: input.maxSelect,
        sortOrder: input.sortOrder,
        options: {
          create: input.options.map((option, index) => ({
            commerceId: ctx.commerceId,
            name: option.name,
            priceDeltaCents: option.priceDeltaCents,
            isAvailable: option.isAvailable,
            sortOrder: option.sortOrder || index,
          })),
        },
      },
      include: { options: true },
    });
    return toModifierGroupDto(group);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('CONFLICT', 'Ya existe un grupo de modificadores con ese nombre');
    }
    throw err;
  }
}

export async function deactivateModifierGroup(
  ctx: TenantContext,
  publicId: string,
): Promise<ModifierGroupDto> {
  const group = await ctx.db.modifierGroup.findFirst({ where: { publicId } });
  if (!group) throw new NotFoundError('El grupo de modificadores no existe');

  const updated = await ctx.db.modifierGroup.update({
    where: { id: group.id },
    data: { isActive: false },
    include: { options: true },
  });
  return toModifierGroupDto(updated);
}
