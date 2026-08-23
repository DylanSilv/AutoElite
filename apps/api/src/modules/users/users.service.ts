import type { CreateUserInput, Page, UpdateUserInput, UserDto } from '@autoelite/shared';
import { Prisma, type User, type UserRole } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { TenantContext } from '../../http/context.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors.js';
import { buildPage, decodeCursor } from '../../shared/pagination.js';
import { hashPassword } from '../../shared/password.js';
import { toUserDto } from './users.mapper.js';
import * as repo from './users.repository.js';

/**
 * Qué roles puede administrar cada rol.
 *
 * Un MANAGER puede dar de alta al personal, pero no puede crear ni tocar a un
 * OWNER: si pudiera, el rol dejaría de ser una barrera real.
 */
const MANAGEABLE_ROLES: Record<string, UserRole[]> = {
  OWNER: ['OWNER', 'MANAGER', 'STAFF'],
  MANAGER: ['STAFF'],
};

function assertCanManage(ctx: TenantContext, targetRole: UserRole): void {
  if (ctx.actor.kind !== 'user') {
    throw new ForbiddenError('FORBIDDEN', 'Esta operación requiere un usuario');
  }
  const allowed = MANAGEABLE_ROLES[ctx.actor.role] ?? [];
  if (!allowed.includes(targetRole)) {
    throw new ForbiddenError('FORBIDDEN', `No podés administrar usuarios con rol ${targetRole}`, {
      allowed,
    });
  }
}

export async function listUsers(
  ctx: TenantContext,
  params: { limit: number; cursor?: string },
): Promise<Page<UserDto>> {
  const rows = await repo.listUsers(
    ctx.db,
    params.limit,
    params.cursor ? decodeCursor(params.cursor) : undefined,
  );
  return buildPage(rows, params.limit, toUserDto);
}

async function getUserOrThrow(ctx: TenantContext, publicId: string): Promise<User> {
  const user = await repo.findUserByPublicId(ctx.db, publicId);
  if (!user) throw new NotFoundError('El usuario no existe');
  return user;
}

export async function getUser(ctx: TenantContext, publicId: string): Promise<UserDto> {
  return toUserDto(await getUserOrThrow(ctx, publicId));
}

export async function createUser(ctx: TenantContext, input: CreateUserInput): Promise<UserDto> {
  assertCanManage(ctx, input.role);

  const passwordHash = await hashPassword(input.password);

  try {
    const user = await repo.createUser(ctx.db, {
      email: input.email,
      passwordHash,
      name: input.name,
      role: input.role,
    });
    return toUserDto(user);
  } catch (err) {
    // El email es único a nivel plataforma, así que el choque puede ser con un
    // usuario de otro comercio que este contexto no puede ver.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('EMAIL_ALREADY_EXISTS', 'Ya existe un usuario con ese email');
    }
    throw err;
  }
}

export async function updateUser(
  ctx: TenantContext,
  publicId: string,
  input: UpdateUserInput,
): Promise<UserDto> {
  const target = await getUserOrThrow(ctx, publicId);

  // Se verifica antes que los permisos de rol: aplica siempre, y da un error
  // que explica el problema real en vez de un "no tenés permisos" genérico.
  const isSelf = ctx.actor.kind === 'user' && ctx.actor.id === target.id;
  if (isSelf && (input.role !== undefined || input.isActive === false)) {
    throw new ForbiddenError(
      'CANNOT_MODIFY_SELF',
      'No podés cambiar tu propio rol ni desactivarte',
    );
  }

  assertCanManage(ctx, target.role);
  if (input.role) assertCanManage(ctx, input.role);

  const updated = await repo.updateUser(ctx.db, target.id, input);

  if (input.isActive === false) {
    // Desactivar tiene que cortar las sesiones abiertas, no solo impedir logins
    // nuevos.
    await prisma.refreshToken.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  return toUserDto(updated);
}
