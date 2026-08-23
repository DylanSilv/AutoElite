import { randomBytes } from 'node:crypto';
import type { AuthenticatedUser, ChangePasswordInput, LoginInput } from '@autoelite/shared';
import { prisma } from '../../db/prisma.js';
import type { Actor } from '../../http/context.js';
import { ForbiddenError, UnauthenticatedError, ValidationError } from '../../shared/errors.js';
import { hashPassword, verifyPassword } from '../../shared/password.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  generateRefreshToken,
  hashSecret,
  signAccessToken,
} from '../../shared/tokens.js';

/**
 * Hash señuelo contra el que se verifica la contraseña cuando el email no
 * existe. Sin esto, el login responde notablemente más rápido ante un email
 * desconocido y se convierte en un oráculo para enumerar usuarios.
 *
 * Se genera de verdad (y una sola vez) en lugar de hardcodearlo: un hash
 * inválido fallaría al parsearse y no consumiría el mismo tiempo, que es
 * justamente lo que se quiere igualar.
 */
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHash;
}

type UserWithCommerce = Awaited<ReturnType<typeof findUserByEmail>>;

function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    include: { commerce: true },
  });
}

export function toAuthenticatedUser(user: NonNullable<UserWithCommerce>): AuthenticatedUser {
  return {
    id: user.publicId,
    email: user.email,
    name: user.name,
    role: user.role,
    commerce: user.commerce
      ? {
          id: user.commerce.publicId,
          name: user.commerce.name,
          timezone: user.commerce.timezone,
          currency: user.commerce.currency,
        }
      : null,
  };
}

async function issueRefreshToken(userId: number): Promise<string> {
  const { token, tokenHash } = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  return token;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthenticatedUser;
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const user = await findUserByEmail(input.email);

  const passwordOk = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), input.password);

  // Mismo error para email inexistente y contraseña incorrecta: distinguirlos
  // le dice a un atacante qué cuentas existen.
  if (!user || !passwordOk) {
    throw new UnauthenticatedError('INVALID_CREDENTIALS', 'Email o contraseña incorrectos');
  }
  if (!user.isActive) {
    throw new ForbiddenError('ACCOUNT_DISABLED', 'La cuenta está desactivada');
  }
  if (user.commerce && !user.commerce.isActive) {
    throw new ForbiddenError('COMMERCE_INACTIVE', 'El comercio está desactivado');
  }

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(user.publicId),
    issueRefreshToken(user.id),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
  ]);

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user: toAuthenticatedUser(user),
  };
}

export async function refresh(presentedToken: string): Promise<LoginResult> {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashSecret(presentedToken) },
    include: { user: { include: { commerce: true } } },
  });

  if (!stored) {
    throw new UnauthenticatedError('TOKEN_INVALID', 'Sesión inválida');
  }

  if (stored.revokedAt) {
    // Un refresh token ya usado que vuelve a aparecer significa que alguien
    // tiene una copia: se cortan todas las sesiones del usuario.
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new UnauthenticatedError('TOKEN_INVALID', 'Sesión inválida');
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    throw new UnauthenticatedError('TOKEN_EXPIRED', 'La sesión expiró');
  }

  const { user } = stored;
  if (!user.isActive) {
    throw new ForbiddenError('ACCOUNT_DISABLED', 'La cuenta está desactivada');
  }
  if (user.commerce && !user.commerce.isActive) {
    throw new ForbiddenError('COMMERCE_INACTIVE', 'El comercio está desactivado');
  }

  // Rotación: el token presentado se invalida y se emite uno nuevo.
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(user.publicId),
    issueRefreshToken(user.id),
  ]);

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user: toAuthenticatedUser(user),
  };
}

export async function logout(presentedToken: string | undefined): Promise<void> {
  if (!presentedToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashSecret(presentedToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function changePassword(actor: Actor, input: ChangePasswordInput): Promise<void> {
  if (actor.kind !== 'user') {
    throw new ForbiddenError('FORBIDDEN', 'Las API keys no tienen contraseña');
  }

  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user) throw new UnauthenticatedError();

  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new UnauthenticatedError('INVALID_CREDENTIALS', 'La contraseña actual es incorrecta');
  }
  if (input.currentPassword === input.newPassword) {
    throw new ValidationError('La nueva contraseña debe ser distinta de la actual');
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    }),
    // Cambiar la contraseña cierra las demás sesiones: es el objetivo de
    // cambiarla cuando se sospecha que alguien más entró.
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

export async function currentUser(actor: Actor): Promise<AuthenticatedUser> {
  if (actor.kind !== 'user') {
    throw new ForbiddenError('FORBIDDEN', 'Esta operación requiere un usuario');
  }
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    include: { commerce: true },
  });
  if (!user) throw new UnauthenticatedError();
  return toAuthenticatedUser(user);
}
