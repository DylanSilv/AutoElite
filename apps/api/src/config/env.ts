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

/**
 * Variable opcional que puede llegar vacía.
 *
 * docker-compose expande `${VAR:-}` a cadena vacía cuando la variable no está
 * definida, y una cadena vacía no es "sin valor" para Zod: sin esto, un
 * despliegue sin credenciales de IA no levantaría por una URL vacía.
 */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

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
  WHATSAPP_PHONE_NUMBER_ID: optional(z.string()),
  WHATSAPP_ACCESS_TOKEN: optional(z.string()),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  /** Cada cuánto se vacía la cola de mensajes pendientes. */
  MESSAGING_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(1000).max(600_000).default(10_000),

  // Webhook entrante de WhatsApp. Meta exige un token para el alta y firma cada
  // entrega con el secreto de la app.
  WHATSAPP_VERIFY_TOKEN: optional(z.string()),
  WHATSAPP_APP_SECRET: optional(z.string()),

  // Asistente conversacional. "scripted" no necesita credenciales ni red: el
  // flujo completo se puede probar y mostrar sin contratar ningún proveedor.
  LLM_PROVIDER: z.enum(['scripted', 'anthropic', 'openai']).default('scripted'),
  LLM_API_KEY: optional(z.string()),
  /** Sin valor por defecto a propósito: el modelo lo elige quien despliega. */
  LLM_MODEL: optional(z.string()),
  LLM_BASE_URL: optional(z.string().url()),
  LLM_MAX_TOKENS: z.coerce.number().int().min(256).max(8192).default(1024),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
  /** Techo de vueltas modelo→herramienta en un mismo mensaje. */
  AGENT_MAX_TOOL_ROUNDS: z.coerce.number().int().min(1).max(10).default(4),
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

// Elegir un proveedor de IA sin credencial ni modelo dejaría al asistente
// mudo recién cuando escriba el primer cliente. Mejor no levantar.
if (env.LLM_PROVIDER !== 'scripted' && (!env.LLM_API_KEY || !env.LLM_MODEL)) {
  console.error(
    `LLM_PROVIDER=${env.LLM_PROVIDER} requiere LLM_API_KEY y LLM_MODEL. ` +
      'Sin eso, usá LLM_PROVIDER=scripted.',
  );
  process.exit(1);
}
