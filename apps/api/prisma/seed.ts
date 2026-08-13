import { PrismaClient, type OrderStatus, type OrderType } from '@prisma/client';
import { isProduction } from '../src/config/env.js';
import { businessDateOf, toDateColumn } from '../src/shared/business-date.js';
import { hashPassword } from '../src/shared/password.js';
import { normalizePhone } from '../src/shared/phone.js';
import { computeLineTotal, computeTotals } from '../src/modules/orders/orders.pricing.js';

/**
 * Datos de demostración de una pizzería.
 *
 * Son ficticios pero con la forma del negocio real: menú con tamaños y extras,
 * zonas de envío, clientes recurrentes e historial de pedidos repartido en las
 * últimas dos semanas. Sirven para mostrar el sistema funcionando; cuando el
 * comercio se sume, se reemplazan por los suyos.
 */

const prisma = new PrismaClient();

const TIMEZONE = 'America/Argentina/Buenos_Aires';
const CUTOFF = '05:00';
const SLUG = 'pizzeria-piloto';

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

/** Precios en centavos: $8.500 → 850000. */
const p = (pesos: number) => pesos * 100;

const PIZZA_SIZES = ['Chica (6 porciones)', 'Mediana (8 porciones)', 'Grande (12 porciones)'];

const MENU = [
  {
    category: 'Pizzas',
    products: [
      { name: 'Muzzarella', description: 'Salsa de tomate, muzzarella y aceitunas', prices: [8500, 11500, 14500] },
      { name: 'Napolitana', description: 'Muzzarella, rodajas de tomate y ajo', prices: [9500, 12800, 16200] },
      { name: 'Fugazzeta', description: 'Cebolla, muzzarella y orégano', prices: [9800, 13200, 16800] },
      { name: 'Especial', description: 'Muzzarella, jamón, morrones y aceitunas', prices: [10500, 14000, 17800] },
      { name: 'Calabresa', description: 'Muzzarella, longaniza calabresa y morrón', prices: [10200, 13800, 17500] },
      { name: 'Jamón y morrones', description: 'Muzzarella, jamón cocido y morrones asados', prices: [10000, 13500, 17000] },
      { name: 'Cuatro quesos', description: 'Muzzarella, roquefort, parmesano y provolone', prices: [11000, 14800, 18500] },
      { name: 'Rúcula y crudo', description: 'Muzzarella, rúcula fresca, jamón crudo y parmesano', prices: [12000, 16000, 20000] },
    ],
    sizes: PIZZA_SIZES,
    modifierGroups: ['Extras para pizza', 'Punto de cocción'],
  },
  {
    category: 'Empanadas',
    products: [
      { name: 'Empanada de carne suave', description: 'Carne cortada a cuchillo', prices: [1200, 12500] },
      { name: 'Empanada de carne picante', description: 'Con un toque de ají molido', prices: [1200, 12500] },
      { name: 'Empanada de jamón y queso', description: null, prices: [1200, 12500] },
      { name: 'Empanada de pollo', description: null, prices: [1200, 12500] },
      { name: 'Empanada de humita', description: 'Choclo cremoso', prices: [1200, 12500] },
      { name: 'Empanada de verdura', description: 'Acelga y salsa blanca', prices: [1200, 12500] },
    ],
    sizes: ['Unidad', 'Docena'],
    modifierGroups: [],
  },
  {
    category: 'Milanesas',
    products: [
      { name: 'Milanesa napolitana con papas', description: 'Con jamón, queso y salsa', prices: [13500] },
      { name: 'Milanesa a caballo', description: 'Con dos huevos fritos y papas', prices: [12800] },
    ],
    sizes: ['Porción'],
    modifierGroups: [],
  },
  {
    category: 'Bebidas',
    products: [
      { name: 'Coca-Cola 1,5L', description: null, prices: [3500] },
      { name: 'Coca-Cola 500ml', description: null, prices: [2200] },
      { name: 'Sprite 1,5L', description: null, prices: [3400] },
      { name: 'Agua mineral 500ml', description: null, prices: [1800] },
      { name: 'Cerveza Quilmes 1L', description: null, prices: [4200] },
      { name: 'Vino tinto Malbec', description: 'Botella 750ml', prices: [6500] },
    ],
    sizes: ['Única'],
    modifierGroups: [],
  },
  {
    category: 'Postres',
    products: [
      { name: 'Flan casero con dulce de leche', description: null, prices: [3800] },
      { name: 'Helado (2 bochas)', description: 'Consultar sabores', prices: [4200] },
    ],
    sizes: ['Única'],
    modifierGroups: [],
  },
] as const;

const MODIFIER_GROUPS = [
  {
    name: 'Extras para pizza',
    minSelect: 0,
    maxSelect: 5,
    options: [
      { name: 'Huevo', priceDeltaCents: p(900) },
      { name: 'Jamón', priceDeltaCents: p(1500) },
      { name: 'Aceitunas', priceDeltaCents: p(700) },
      { name: 'Morrón', priceDeltaCents: p(800) },
      { name: 'Extra muzzarella', priceDeltaCents: p(1800) },
      { name: 'Panceta', priceDeltaCents: p(1900) },
    ],
  },
  {
    name: 'Punto de cocción',
    minSelect: 0,
    maxSelect: 1,
    options: [
      { name: 'Bien cocida', priceDeltaCents: 0 },
      { name: 'Poco cocida', priceDeltaCents: 0 },
    ],
  },
];

const DELIVERY_ZONES = [
  { name: 'Centro', feeCents: p(1500), estimatedMin: 20 },
  { name: 'Zona norte', feeCents: p(2200), estimatedMin: 30 },
  { name: 'Zona sur', feeCents: p(2500), estimatedMin: 35 },
  { name: 'Zona oeste', feeCents: p(2800), estimatedMin: 40 },
];

const PAYMENT_METHODS = [
  { name: 'Efectivo', code: 'CASH', requiresChangeFor: true },
  { name: 'Transferencia', code: 'TRANSFER', requiresChangeFor: false },
  { name: 'Débito', code: 'DEBIT', requiresChangeFor: false },
  { name: 'Crédito', code: 'CREDIT', requiresChangeFor: false },
  { name: 'Mercado Pago', code: 'MP', requiresChangeFor: false },
];

const CUSTOMERS = [
  { name: 'Martina Gómez', phone: '11 4567-8901', street: 'Av. Rivadavia', number: '4520', apartment: '3B', neighborhood: 'Centro', reference: 'Timbre 3B, portón negro' },
  { name: 'Diego Fernández', phone: '11 5623-1147', street: 'San Martín', number: '812', neighborhood: 'Zona norte', reference: 'Casa con reja verde' },
  { name: 'Lucía Ramírez', phone: '11 3345-9902', street: 'Belgrano', number: '1290', apartment: 'PB A', neighborhood: 'Centro' },
  { name: 'Javier Sosa', phone: '11 6712-4488', street: 'Mitre', number: '345', neighborhood: 'Zona sur', reference: 'Al lado del kiosco' },
  { name: 'Carolina Ledesma', phone: '11 2298-7735', street: 'Sarmiento', number: '2210', apartment: '7C', neighborhood: 'Zona oeste' },
  { name: 'Nicolás Ortiz', phone: '11 4488-2091', street: 'Alsina', number: '655', neighborhood: 'Centro' },
  { name: 'Florencia Ríos', phone: '11 5511-6678', street: 'Moreno', number: '1876', neighborhood: 'Zona norte', reference: 'Edificio azul, 2do piso' },
  { name: 'Sebastián Paz', phone: '11 7723-3390', street: 'Urquiza', number: '430', neighborhood: 'Zona sur' },
];

// ---------------------------------------------------------------------------
// Generación de pedidos históricos
// ---------------------------------------------------------------------------

/**
 * Generador pseudoaleatorio con semilla fija.
 *
 * La demo tiene que verse igual cada vez que se levanta: números distintos en
 * cada arranque harían imposible mostrar lo mismo dos veces.
 */
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const random = seededRandom(20260813);

function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('Lista vacía');
  return item;
}

function pickWeighted<T>(entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[0]![0];
}

async function main(): Promise<void> {
  const email = process.env.SEED_OWNER_EMAIL ?? 'admin@pizzeria.local';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'demo-pizzeria-2026';

  if (isProduction && !process.env.SEED_OWNER_PASSWORD) {
    throw new Error('En producción hay que definir SEED_OWNER_PASSWORD explícitamente.');
  }

  const commerce = await prisma.commerce.upsert({
    where: { slug: SLUG },
    update: {},
    create: {
      name: 'La Napolitana',
      slug: SLUG,
      phone: '+5491145678900',
      address: 'Av. Rivadavia 4500, CABA',
      timezone: TIMEZONE,
      currency: 'ARS',
      businessDayCutoff: CUTOFF,
    },
  });

  // Se limpian sólo los datos operativos del comercio piloto: el seed se puede
  // correr varias veces sin duplicar el menú ni los pedidos.
  await prisma.order.deleteMany({ where: { commerceId: commerce.id } });
  await prisma.$executeRaw`DELETE FROM OrderCounter WHERE commerceId = ${commerce.id}`;
  await prisma.customer.deleteMany({ where: { commerceId: commerce.id } });
  await prisma.product.deleteMany({ where: { commerceId: commerce.id } });
  await prisma.modifierGroup.deleteMany({ where: { commerceId: commerce.id } });
  await prisma.category.deleteMany({ where: { commerceId: commerce.id } });
  await prisma.deliveryZone.deleteMany({ where: { commerceId: commerce.id } });
  await prisma.paymentMethod.deleteMany({ where: { commerceId: commerce.id } });

  // ---------- Equipo ----------

  const team = [
    { email, name: 'Dueño', role: 'OWNER' as const, password },
    { email: 'encargado@pizzeria.local', name: 'Encargada', role: 'MANAGER' as const, password: 'demo-pizzeria-2026' },
    { email: 'mostrador@pizzeria.local', name: 'Mostrador', role: 'STAFF' as const, password: 'demo-pizzeria-2026' },
  ];

  for (const member of team) {
    const existing = await prisma.user.findUnique({ where: { email: member.email } });
    if (!existing) {
      await prisma.user.create({
        data: {
          commerceId: commerce.id,
          email: member.email,
          passwordHash: await hashPassword(member.password),
          name: member.name,
          role: member.role,
        },
      });
    }
  }

  // ---------- Configuración operativa ----------

  const zones = await Promise.all(
    DELIVERY_ZONES.map((zone, index) =>
      prisma.deliveryZone.create({
        data: { ...zone, commerceId: commerce.id, sortOrder: index },
      }),
    ),
  );

  const paymentMethods = await Promise.all(
    PAYMENT_METHODS.map((method, index) =>
      prisma.paymentMethod.create({
        data: { ...method, commerceId: commerce.id, sortOrder: index },
      }),
    ),
  );

  // ---------- Modificadores ----------

  const modifierGroups = new Map<string, { id: number; options: { id: number; name: string; priceDeltaCents: number }[] }>();

  for (const [index, group] of MODIFIER_GROUPS.entries()) {
    const created = await prisma.modifierGroup.create({
      data: {
        commerceId: commerce.id,
        name: group.name,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        sortOrder: index,
        options: {
          create: group.options.map((option, optionIndex) => ({
            commerceId: commerce.id,
            name: option.name,
            priceDeltaCents: option.priceDeltaCents,
            sortOrder: optionIndex,
          })),
        },
      },
      include: { options: true },
    });
    modifierGroups.set(group.name, {
      id: created.id,
      options: created.options.map((o) => ({
        id: o.id,
        name: o.name,
        priceDeltaCents: o.priceDeltaCents,
      })),
    });
  }

  // ---------- Menú ----------

  interface SeedVariant {
    id: number;
    name: string;
    priceCents: number;
    productId: number;
    productName: string;
    category: string;
  }
  const allVariants: SeedVariant[] = [];

  for (const [categoryIndex, block] of MENU.entries()) {
    const category = await prisma.category.create({
      data: { commerceId: commerce.id, name: block.category, sortOrder: categoryIndex },
    });

    for (const [productIndex, product] of block.products.entries()) {
      const created = await prisma.product.create({
        data: {
          commerceId: commerce.id,
          categoryId: category.id,
          name: product.name,
          description: product.description,
          sortOrder: productIndex,
          variants: {
            create: product.prices.map((price, sizeIndex) => ({
              commerceId: commerce.id,
              name: block.sizes[sizeIndex] ?? 'Única',
              priceCents: p(price),
              sortOrder: sizeIndex,
            })),
          },
          modifierGroups: {
            create: block.modifierGroups
              .map((name) => modifierGroups.get(name))
              .filter((group): group is NonNullable<typeof group> => Boolean(group))
              .map((group, index) => ({ modifierGroupId: group.id, sortOrder: index })),
          },
        },
        include: { variants: true },
      });

      for (const variant of created.variants) {
        allVariants.push({
          id: variant.id,
          name: variant.name,
          priceCents: variant.priceCents,
          productId: created.id,
          productName: created.name,
          category: block.category,
        });
      }
    }
  }

  // ---------- Clientes ----------

  const customers = await Promise.all(
    CUSTOMERS.map(async (customer) => {
      const zone = zones.find((z) => z.name === customer.neighborhood) ?? zones[0]!;
      return prisma.customer.create({
        data: {
          commerceId: commerce.id,
          name: customer.name,
          phoneE164: normalizePhone(customer.phone),
          phoneRaw: customer.phone,
          addresses: {
            create: {
              commerceId: commerce.id,
              label: 'Casa',
              street: customer.street,
              number: customer.number,
              apartment: 'apartment' in customer ? (customer.apartment ?? null) : null,
              neighborhood: customer.neighborhood,
              city: 'CABA',
              reference: 'reference' in customer ? (customer.reference ?? null) : null,
              deliveryZoneId: zone.id,
              isDefault: true,
            },
          },
        },
        include: { addresses: true },
      });
    }),
  );

  // ---------- Pedidos ----------

  const pizzaVariants = allVariants.filter((v) => v.category === 'Pizzas');
  const drinkVariants = allVariants.filter((v) => v.category === 'Bebidas');
  const otherVariants = allVariants.filter((v) => !['Pizzas', 'Bebidas'].includes(v.category));
  const extras = modifierGroups.get('Extras para pizza')!.options;

  const counters = new Map<string, number>();
  const nextNumber = (businessDate: string): number => {
    const value = (counters.get(businessDate) ?? 0) + 1;
    counters.set(businessDate, value);
    return value;
  };

  function buildLines() {
    const lines: {
      variant: SeedVariant;
      quantity: number;
      modifiers: { id: number; name: string; priceDeltaCents: number }[];
    }[] = [];

    const pizzaCount = pickWeighted([
      [1, 50],
      [2, 30],
      [3, 15],
      [4, 5],
    ] as const);

    for (let i = 0; i < pizzaCount; i += 1) {
      const modifiers = random() < 0.3 ? [pick(extras)] : [];
      lines.push({ variant: pick(pizzaVariants), quantity: 1, modifiers });
    }

    if (random() < 0.55) {
      lines.push({ variant: pick(drinkVariants), quantity: random() < 0.25 ? 2 : 1, modifiers: [] });
    }
    if (random() < 0.3) {
      lines.push({ variant: pick(otherVariants), quantity: 1, modifiers: [] });
    }

    return lines;
  }

  async function createSeedOrder(placedAt: Date, status: OrderStatus): Promise<void> {
    const businessDate = businessDateOf(placedAt, TIMEZONE, CUTOFF);
    const type = pickWeighted([
      ['DELIVERY', 55],
      ['TAKEAWAY', 30],
      ['DINE_IN', 15],
    ] as const) as OrderType;

    const customer = pick(customers);
    const address = customer.addresses[0]!;
    const zone = zones.find((z) => z.id === address.deliveryZoneId) ?? zones[0]!;
    const paymentMethod = pickWeighted([
      [paymentMethods[0]!, 40],
      [paymentMethods[1]!, 25],
      [paymentMethods[4]!, 20],
      [paymentMethods[2]!, 10],
      [paymentMethods[3]!, 5],
    ] as const);

    const lines = buildLines().map((line) => ({
      ...line,
      lineTotalCents: computeLineTotal(line.variant.priceCents, line.modifiers, line.quantity),
    }));

    const deliveryFeeCents = type === 'DELIVERY' ? zone.feeCents : 0;
    const totals = computeTotals(
      lines.map((line) => ({
        productId: line.variant.productId,
        variantId: line.variant.id,
        productName: line.variant.productName,
        variantName: line.variant.name,
        unitPriceCents: line.variant.priceCents,
        quantity: line.quantity,
        notes: null,
        modifiers: line.modifiers.map((m) => ({
          optionId: m.id,
          name: m.name,
          priceDeltaCents: m.priceDeltaCents,
        })),
        lineTotalCents: line.lineTotalCents,
      })),
      deliveryFeeCents,
      0,
    );

    const isDelivery = type === 'DELIVERY';

    await prisma.order.create({
      data: {
        commerceId: commerce.id,
        number: nextNumber(businessDate),
        businessDate: toDateColumn(businessDate),
        type,
        status,
        source: random() < 0.2 ? 'PHONE' : 'PANEL',
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phoneE164,
        deliveryStreet: isDelivery ? address.street : null,
        deliveryNumber: isDelivery ? address.number : null,
        deliveryApartment: isDelivery ? address.apartment : null,
        deliveryNeighborhood: isDelivery ? address.neighborhood : null,
        deliveryReference: isDelivery ? address.reference : null,
        deliveryZoneName: isDelivery ? zone.name : null,
        paymentMethodId: paymentMethod.id,
        paymentMethodName: paymentMethod.name,
        isPaid: status === 'ENTREGADO',
        subtotalCents: totals.subtotalCents,
        deliveryFeeCents: totals.deliveryFeeCents,
        discountCents: totals.discountCents,
        totalCents: totals.totalCents,
        placedAt,
        items: {
          create: lines.map((line) => ({
            commerceId: commerce.id,
            productId: line.variant.productId,
            variantId: line.variant.id,
            productName: line.variant.productName,
            variantName: line.variant.name,
            unitPriceCents: line.variant.priceCents,
            quantity: line.quantity,
            lineTotalCents: line.lineTotalCents,
            modifiers: {
              create: line.modifiers.map((m) => ({
                commerceId: commerce.id,
                optionId: m.id,
                name: m.name,
                priceDeltaCents: m.priceDeltaCents,
              })),
            },
          })),
        },
        statusHistory: {
          create: { commerceId: commerce.id, fromStatus: null, toStatus: status },
        },
      },
    });
  }

  const now = new Date();

  // Historial: dos semanas de pedidos cerrados, con más volumen los fines de
  // semana, para que el dashboard muestre una curva creíble.
  for (let daysAgo = 14; daysAgo >= 1; daysAgo -= 1) {
    const day = new Date(now);
    day.setDate(day.getDate() - daysAgo);
    const weekday = day.getDay();
    const isWeekend = weekday === 5 || weekday === 6 || weekday === 0;
    const ordersToday = isWeekend ? 14 + Math.floor(random() * 8) : 6 + Math.floor(random() * 5);

    for (let i = 0; i < ordersToday; i += 1) {
      const placedAt = new Date(day);
      // Servicio de noche: entre las 19:00 y las 23:30.
      placedAt.setHours(19 + Math.floor(random() * 4), Math.floor(random() * 60), 0, 0);
      await createSeedOrder(placedAt, random() < 0.05 ? 'CANCELADO' : 'ENTREGADO');
    }
  }

  // Servicio en curso: pedidos vivos repartidos por estado, para que el tablero
  // se vea como durante un viernes a la noche.
  //
  // El orden va del más viejo al más nuevo, y el estado acompaña: los que ya se
  // entregaron entraron hace rato y los pendientes recién llegaron. Al revés, el
  // tablero mostraría pedidos "pendientes hace dos horas", que en una pizzería
  // real significaría que algo salió muy mal.
  const liveStatuses: OrderStatus[] = [
    'ENTREGADO',
    'ENTREGADO',
    'ENTREGADO',
    'EN_CAMINO',
    'EN_CAMINO',
    'LISTO',
    'LISTO',
    'EN_PREPARACION',
    'EN_PREPARACION',
    'EN_PREPARACION',
    'CONFIRMADO',
    'CONFIRMADO',
    'PENDIENTE',
    'PENDIENTE',
    'PENDIENTE',
  ];

  for (const [index, status] of liveStatuses.entries()) {
    const placedAt = new Date(now.getTime() - (liveStatuses.length - index) * 7 * 60 * 1000);
    await createSeedOrder(placedAt, status);
  }

  // El contador tiene que quedar donde lo dejó el seed: si no, el primer pedido
  // que cargue el usuario chocaría con un número ya usado.
  for (const [businessDate, lastNumber] of counters) {
    await prisma.$executeRaw`
      INSERT INTO OrderCounter (commerceId, businessDate, lastNumber)
      VALUES (${commerce.id}, ${toDateColumn(businessDate)}, ${lastNumber})
      ON DUPLICATE KEY UPDATE lastNumber = ${lastNumber}
    `;
  }

  // Los agregados por cliente se recalculan al final, una vez cargado todo.
  for (const customer of customers) {
    const stats = await prisma.order.aggregate({
      where: { customerId: customer.id, status: { not: 'CANCELADO' } },
      _count: { _all: true },
      _sum: { totalCents: true },
      _max: { placedAt: true },
    });
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        ordersCount: stats._count._all,
        totalSpentCents: stats._sum.totalCents ?? 0,
        lastOrderAt: stats._max.placedAt,
      },
    });
  }

  const totalOrders = await prisma.order.count({ where: { commerceId: commerce.id } });

  console.log(`Comercio: ${commerce.name} (${commerce.slug})`);
  console.log(`Menú: ${allVariants.length} variantes en ${MENU.length} categorías`);
  console.log(`Clientes: ${customers.length} · Pedidos: ${totalOrders}`);
  console.log(`Acceso: ${email} / ${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
