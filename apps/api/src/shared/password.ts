import { hash, verify } from '@node-rs/argon2';

// Argon2id con parámetros por encima del mínimo recomendado por OWASP
// (19 MiB, 2 iteraciones). Subirlos después es seguro: el hash guarda sus
// propios parámetros, así que las contraseñas viejas siguen verificando.
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain, OPTIONS);
  } catch {
    // Un hash corrupto o con otro formato no debe tumbar el login.
    return false;
  }
}
