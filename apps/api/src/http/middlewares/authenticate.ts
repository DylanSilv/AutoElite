import type { ApiScope } from '@autoelite/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { prisma } from '../../db/prisma.js';
import { ForbiddenError, UnauthenticatedError } from '../../shared/errors.js';
import { DEFAULT_COUNTRY, isSupportedCountry } from '../../shared/phone.js';
import { hashSecret, verifyAccessToken } from '../../shared/tokens.js';
import type { CommerceSettings } from '../context.js';

const API_KEY_PREFIX = 'ae_';
/** Evita un UPDATE por request solo para registrar el uso de una API key. */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

function readCredential(req: Request): { kind: 'jwt' | 'apiKey'; value: string } | null {
  const apiKeyHeader = req.get('x-api-key');
  if (apiKeyHeader) return { kind: 'apiKey', value: apiKeyHeader.trim() };

  const authorization = req.get('authorization');
  if (!authorization) return null;

  const [scheme, ...rest] = authorization.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;

  const value = rest.join(' ').trim();
  if (!value) return null;

  // n8n y el agente suelen mandar todo por Authorization; el prefijo distingue
  // una API key de un JWT sin necesidad de intentar verificar las dos cosas.
  return value.startsWith(API_KEY_PREFIX) ? { kind: 'apiKey', value } : { kind: 'jwt', value };
}

function parseScopes(raw: unknown): ApiScope[] {
  return Array.isArray(raw) ? (raw.filter((s): s is ApiScope => typeof s === 'string') as ApiScope[]) : [];
}

/** Campos del comercio que viajan en el contexto de cada request. */
const commerceSelect = {
  id: true,
  publicId: true,
  name: true,
  country: true,
  timezone: true,
  currency: true,
  businessDayCutoff: true,
  openingHours: true,
  isActive: true,
} as const;

function toCommerceSettings(commerce: {
  id: number;
  publicId: string;
  name: string;
  country: string;
  timezone: string;
  currency: string;
  businessDayCutoff: string;
  openingHours: string | null;
}): CommerceSettings {
  return {
    id: commerce.id,
    publicId: commerce.publicId,
    name: commerce.name,
    country: isSupportedCountry(commerce.country) ? commerce.country : DEFAULT_COUNTRY,
    timezone: commerce.timezone,
    currency: commerce.currency,
    businessDayCutoff: commerce.businessDayCutoff,
    openingHours: commerce.openingHours,
  };
}

async function authenticateUser(req: Request, token: string): Promise<void> {
  const { sub } = await verifyAccessToken(token);

  // Se relee el usuario en cada request en lugar de confiar en lo que dice el
  // token: así desactivar una cuenta tiene efecto inmediato en vez de esperar a
  // que expire el access token.
  const user = await prisma.user.findUnique({
    where: { publicId: sub },
    include: { commerce: { select: commerceSelect } },
  });

  if (!user) throw new UnauthenticatedError('TOKEN_INVALID', 'Token inválido');
  if (!user.isActive) throw new ForbiddenError('ACCOUNT_DISABLED', 'La cuenta está desactivada');
  if (user.commerce && !user.commerce.isActive) {
    throw new ForbiddenError('COMMERCE_INACTIVE', 'El comercio está desactivado');
  }

  req.actor = {
    kind: 'user',
    id: user.id,
    publicId: user.publicId,
    email: user.email,
    name: user.name,
    role: user.role,
    commerceId: user.commerceId,
    commerce: user.commerce ? toCommerceSettings(user.commerce) : null,
  };
}

async function authenticateApiClient(req: Request, key: string): Promise<void> {
  const client = await prisma.apiClient.findUnique({
    where: { keyHash: hashSecret(key) },
    include: { commerce: { select: commerceSelect } },
  });

  if (!client || client.revokedAt) {
    throw new UnauthenticatedError('TOKEN_INVALID', 'API key inválida o revocada');
  }
  if (!client.commerce.isActive) {
    throw new ForbiddenError('COMMERCE_INACTIVE', 'El comercio está desactivado');
  }

  req.actor = {
    kind: 'apiClient',
    id: client.id,
    publicId: client.publicId,
    name: client.name,
    scopes: parseScopes(client.scopes),
    commerceId: client.commerceId,
    commerce: toCommerceSettings(client.commerce),
  };

  const stale =
    !client.lastUsedAt || Date.now() - client.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS;
  if (stale) {
    // No bloquea la respuesta: es telemetría, no parte de la autenticación.
    void prisma.apiClient
      .update({ where: { id: client.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
}

/** Exige credenciales válidas: JWT de una persona o API key de una máquina. */
export const authenticate: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const credential = readCredential(req);
    if (!credential) throw new UnauthenticatedError('UNAUTHENTICATED', 'Faltan credenciales');

    if (credential.kind === 'apiKey') {
      await authenticateApiClient(req, credential.value);
    } else {
      await authenticateUser(req, credential.value);
    }
    next();
  } catch (err) {
    next(err);
  }
};
