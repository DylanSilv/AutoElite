import { PrismaClient } from '@prisma/client';
import { isProduction } from '../src/config/env.js';
import { hashPassword } from '../src/shared/password.js';

const prisma = new PrismaClient();

/**
 * Datos mínimos para levantar el entorno: el comercio piloto y su dueño.
 *
 * Es idempotente, así que se puede correr varias veces sin duplicar nada.
 */
async function main(): Promise<void> {
  const email = process.env.SEED_OWNER_EMAIL ?? 'admin@pizzeria.local';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'cambiar-esta-clave';

  if (isProduction && !process.env.SEED_OWNER_PASSWORD) {
    throw new Error('En producción hay que definir SEED_OWNER_PASSWORD explícitamente.');
  }

  const commerce = await prisma.commerce.upsert({
    where: { slug: 'pizzeria-piloto' },
    update: {},
    create: {
      name: 'Pizzería Piloto',
      slug: 'pizzeria-piloto',
      timezone: 'America/Argentina/Buenos_Aires',
      currency: 'ARS',
      businessDayCutoff: '05:00',
    },
  });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        commerceId: commerce.id,
        email,
        passwordHash: await hashPassword(password),
        name: 'Dueño',
        role: 'OWNER',
      },
    });
    console.log(`Usuario creado: ${email}`);
    if (!process.env.SEED_OWNER_PASSWORD) {
      console.log(`Contraseña inicial: ${password} — cambiala en el primer login.`);
    }
  } else {
    console.log(`El usuario ${email} ya existe, no se toca.`);
  }

  console.log(`Comercio listo: ${commerce.name} (${commerce.slug})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
