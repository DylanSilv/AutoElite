import type {
  ApiClientDto,
  ApiClientWithSecretDto,
  CreateApiClientInput,
} from '@autoelite/shared';
import type { ApiClient } from '@prisma/client';
import type { TenantContext } from '../../http/context.js';
import { NotFoundError } from '../../shared/errors.js';
import { generateApiKey } from '../../shared/tokens.js';

function toApiClientDto(client: ApiClient): ApiClientDto {
  return {
    id: client.publicId,
    name: client.name,
    scopes: Array.isArray(client.scopes) ? (client.scopes as string[]) : [],
    lastUsedAt: client.lastUsedAt?.toISOString() ?? null,
    revokedAt: client.revokedAt?.toISOString() ?? null,
    createdAt: client.createdAt.toISOString(),
  };
}

export async function listApiClients(ctx: TenantContext): Promise<ApiClientDto[]> {
  const clients = await ctx.db.apiClient.findMany({ orderBy: { id: 'asc' } });
  return clients.map(toApiClientDto);
}

/**
 * La clave en texto plano se devuelve una única vez, acá. Después sólo queda el
 * hash: si se pierde, se revoca y se emite otra.
 */
export async function createApiClient(
  ctx: TenantContext,
  input: CreateApiClientInput,
): Promise<ApiClientWithSecretDto> {
  const { key, keyHash } = generateApiKey();

  const client = await ctx.db.apiClient.create({
    // El `commerceId` va explícito porque Prisma lo exige en el tipo. La
    // extensión lo sobrescribe igual con el del contexto, así que sigue siendo
    // imposible crear una credencial para otro comercio.
    data: { name: input.name, keyHash, scopes: input.scopes, commerceId: ctx.commerceId },
  });

  return { ...toApiClientDto(client), key };
}

export async function revokeApiClient(ctx: TenantContext, publicId: string): Promise<ApiClientDto> {
  const client = await ctx.db.apiClient.findFirst({ where: { publicId } });
  if (!client) throw new NotFoundError('La API key no existe');

  // Idempotente: revocar dos veces no es un error ni corre la fecha original.
  if (client.revokedAt) return toApiClientDto(client);

  const revoked = await ctx.db.apiClient.update({
    where: { id: client.id },
    data: { revokedAt: new Date() },
  });
  return toApiClientDto(revoked);
}
