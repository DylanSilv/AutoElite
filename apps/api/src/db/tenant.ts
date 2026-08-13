import { prisma } from './prisma.js';

/**
 * Aislamiento multi-tenant.
 *
 * Poner `commerceId` en todas las tablas es la parte fácil. La difícil es que
 * *una sola* consulta sin filtrar filtra los datos de un comercio a otro, y
 * Prisma sobre MySQL no tiene row-level security.
 *
 * En vez de confiar en que nadie se olvide de escribir el `where`, se inyecta
 * automáticamente en cada operación sobre los modelos marcados abajo. Olvidarse
 * deja de ser posible por construcción.
 *
 * El `commerceId` sale siempre del token, nunca de la URL ni del body.
 *
 * LÍMITE IMPORTANTE: la extensión sólo alcanza los argumentos del modelo raíz
 * de cada operación. En una escritura anidada (`product.create` con
 * `variants: { create: [...] }`) las filas hijas NO reciben el `commerceId`
 * automáticamente y hay que pasarlo explícito. Por eso los modelos hijos lo
 * declaran como obligatorio: así el compilador obliga a completarlo en vez de
 * dejar filas huérfanas de comercio.
 */

/** Modelos con columna `commerceId`. Agregar acá cada modelo nuevo del negocio. */
const TENANT_MODELS = new Set<string>([
  'User',
  'ApiClient',
  'Category',
  'Product',
  'ProductVariant',
  'ModifierGroup',
  'ModifierOption',
  'Customer',
  'CustomerAddress',
  'DeliveryZone',
  'PaymentMethod',
  'Order',
  'OrderItem',
  'OrderItemModifier',
  'OrderStatusHistory',
  'OutboundMessage',
]);

/** Operaciones cuyo `where` acota qué filas se leen o se tocan. */
const WHERE_OPERATIONS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

/** Operaciones que insertan filas y por lo tanto necesitan el `commerceId`. */
const CREATE_OPERATIONS = new Set<string>(['create', 'createMany', 'createManyAndReturn', 'upsert']);

type AnyArgs = Record<string, unknown>;

function withCommerce(value: unknown, commerceId: number): AnyArgs {
  return { ...(value as AnyArgs | undefined), commerceId };
}

/**
 * Devuelve un cliente de Prisma acotado a un comercio.
 *
 * Se crea uno por request a partir del contexto de autenticación. Es barato:
 * `$extends` no abre conexiones nuevas, envuelve al mismo cliente.
 */
export function forCommerce(commerceId: number) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);

          // Se compara como string a propósito: la unión de operaciones que
          // tipa Prisma cambia entre versiones, y una operación no contemplada
          // acá sería un agujero en el aislamiento, no un error de compilación.
          const op: string = operation;
          const next = { ...(args as AnyArgs) };

          if (WHERE_OPERATIONS.has(op)) {
            next.where = withCommerce(next.where, commerceId);
          }

          if (CREATE_OPERATIONS.has(op)) {
            if (op === 'createMany' || op === 'createManyAndReturn') {
              const data = next.data;
              next.data = Array.isArray(data)
                ? data.map((row) => withCommerce(row, commerceId))
                : withCommerce(data, commerceId);
            } else {
              // create y upsert: `create` es el payload de inserción.
              const key = op === 'upsert' ? 'create' : 'data';
              next[key] = withCommerce(next[key], commerceId);
            }
          }

          return query(next);
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof forCommerce>;

/**
 * Cliente sin acotar. Usarlo solo donde el aislamiento no aplica: login (que
 * resuelve el comercio a partir del usuario), administración de la plataforma y
 * los propios tests de aislamiento.
 */
export const unscopedPrisma = prisma;
