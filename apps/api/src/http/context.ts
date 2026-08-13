import type { ApiScope, UserRole } from '@autoelite/shared';
import type { Request } from 'express';
import { forCommerce, type TenantClient } from '../db/tenant.js';
import { ForbiddenError, UnauthenticatedError } from '../shared/errors.js';
import type { CountryCode } from '../shared/phone.js';

/**
 * Quién está haciendo el request. Personas y máquinas son identidades distintas
 * a propósito (ver docs/01, sección 2.9).
 */
/**
 * Configuración del comercio que necesita casi cualquier operación.
 *
 * Viaja en el contexto porque el middleware de autenticación ya consulta el
 * comercio: volver a pedirlo en cada service sería una consulta de más por
 * request para leer siempre lo mismo.
 */
export interface CommerceSettings {
  id: number;
  publicId: string;
  name: string;
  country: CountryCode;
  timezone: string;
  currency: string;
  businessDayCutoff: string;
}

export type Actor =
  | {
      kind: 'user';
      id: number;
      publicId: string;
      email: string;
      name: string;
      role: UserRole;
      commerceId: number | null;
      commerce: CommerceSettings | null;
    }
  | {
      kind: 'apiClient';
      id: number;
      publicId: string;
      name: string;
      scopes: ApiScope[];
      commerceId: number;
      commerce: CommerceSettings;
    };

/** Contexto que reciben los services. No conocen `req` ni `res`. */
export interface RequestContext {
  requestId: string;
  actor: Actor;
}

/** Contexto de una operación dentro de un comercio concreto. */
export interface TenantContext extends RequestContext {
  commerceId: number;
  commerce: CommerceSettings;
  db: TenantClient;
}

export function getActor(req: Request): Actor {
  if (!req.actor) throw new UnauthenticatedError();
  return req.actor;
}

export function getContext(req: Request): RequestContext {
  return { requestId: req.requestId, actor: getActor(req) };
}

/**
 * Contexto acotado a un comercio. El `commerceId` sale del actor autenticado,
 * nunca de la URL ni del body: si viniera del cliente, cualquiera podría leer
 * los datos de otro comercio cambiando un parámetro.
 */
export function getTenantContext(req: Request): TenantContext {
  const actor = getActor(req);
  if (actor.commerceId === null || actor.commerce === null) {
    throw new ForbiddenError(
      'COMMERCE_REQUIRED',
      'Esta operación requiere estar asociado a un comercio',
    );
  }
  return {
    requestId: req.requestId,
    actor,
    commerceId: actor.commerceId,
    commerce: actor.commerce,
    db: forCommerce(actor.commerceId),
  };
}
