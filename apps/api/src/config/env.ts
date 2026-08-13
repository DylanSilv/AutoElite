import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

// El .env vive en la raíz del monorepo para que la API y las herramientas de
// Prisma lean exactamente los mismos valores.
//
// En tests se prefiere .env.test y se cae a .env; fuera de tests NUNCA se lee
// .env.test, para que una tarea de desarrollo no termine escribiendo en la base
// de pruebas.
const envCandidates = process.env.NODE_ENV === 'test' ? ['.env.test', '.env'] : ['.env'];

for (const candidate of envCandidates) {
  const file = path.join(repoRoot, candidate);
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1),

  // 32 caracteres es el piso para que la firma HS256 no sea el eslabón débil.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET debe tener al menos 32 caracteres'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Mensajería saliente. Sin credenciales, "log" simula los envíos y deja el
  // mensaje en la consola: alcanza para probar todo el flujo sin una cuenta de
  // Meta ni gastar conversaciones.
  WHATSAPP_PROVIDER: z.enum(['log', 'cloud']).default('log'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  /** Cada cuánto se vacía la cola de mensajes pendientes. */
  MESSAGING_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(1000).max(600_000).default(10_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Falta o está mal una variable: el proceso no debe levantar a medias.
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(raíz)'}: ${i.message}`)
    .join('\n');
  console.error(`Configuración inválida. Revisá el .env:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

if (isProduction && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
  console.error('JWT_ACCESS_SECRET y JWT_REFRESH_SECRET no pueden ser iguales en producción.');
  process.exit(1);
}
