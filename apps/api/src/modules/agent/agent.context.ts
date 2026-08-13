import type { ApiScope } from '@autoelite/shared';
import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { forCommerce } from '../../db/tenant.js';
import type { TenantContext } from '../../http/context.js';
import type { CountryCode } from '../../shared/phone.js';

/**
 * Identidad con la que actúa el asistente.
 *
 * Un mensaje que llega por el webhook no viene autenticado como nadie: Meta
 * firma la entrega, pero no hay usuario del panel detrás. Los pedidos que el
 * asistente crea igual tienen que quedar atribuidos a alguien, así que actúa
 * como una credencial de máquina propia, separada de las personas.
 *
 * Es una identidad, no una credencial de acceso: la clave se genera aleatoria y
 * se descarta, así que nadie puede autenticarse como el asistente desde afuera.
 */

const AGENT_CLIENT_NAME = 'Asistente de WhatsApp';
const AGENT_SCOPES: ApiScope[] = ['catalog:read', 'customers:read', 'customers:write', 'orders:read', 'orders:write'];

async function findOrCreateAgentClient(commerceId: number) {
  const existing = await prisma.apiClient.findFirst({
    where: { commerceId, name: AGENT_CLIENT_NAME, revokedAt: null },
  });
  if (existing) return existing;

  // Hash de un secreto que nunca existió en texto plano fuera de esta función:
  // la fila sirve para atribuir pedidos, no para entrar por la API.
  const unusableKeyHash = createHash('sha256').update(randomBytes(48)).digest('hex');

  return prisma.apiClient.create({
    data: {
      commerceId,
      name: AGENT_CLIENT_NAME,
      keyHash: unusableKeyHash,
      scopes: AGENT_SCOPES,
    },
  });
}

/**
 * Contexto de comercio para procesar un mensaje entrante sin request
 * autenticado.
 */
export async function buildAgentContext(commerceId: number): Promise<TenantContext | null> {
  const commerce = await prisma.commerce.findFirst({ where: { id: commerceId, isActive: true } });
  if (!commerce) return null;

  const client = await findOrCreateAgentClient(commerceId);

  const settings = {
    id: commerce.id,
    publicId: commerce.publicId,
    name: commerce.name,
    country: commerce.country as CountryCode,
    timezone: commerce.timezone,
    currency: commerce.currency,
    businessDayCutoff: commerce.businessDayCutoff,
  };

  return {
    requestId: `agent-${Date.now()}`,
    actor: {
      kind: 'apiClient',
      id: client.id,
      publicId: client.publicId,
      name: client.name,
      scopes: AGENT_SCOPES,
      commerceId,
      commerce: settings,
    },
    commerceId,
    commerce: settings,
    db: forCommerce(commerceId),
  };
}

/** A qué comercio pertenece un número de WhatsApp. */
export async function findCommerceByWhatsAppNumber(
  phoneNumberId: string,
): Promise<number | null> {
  const commerce = await prisma.commerce.findFirst({
    where: { whatsappPhoneNumberId: phoneNumberId, isActive: true },
    select: { id: true },
  });
  return commerce?.id ?? null;
}
