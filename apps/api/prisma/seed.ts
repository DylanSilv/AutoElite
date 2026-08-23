import { PrismaClient, type OrderStatus, type OrderType } from '@prisma/client';
import { isProduction } from '../src/config/env.js';
import { businessDateOf, toDateColumn } from '../src/shared/business-date.js';
import { hashPassword } from '../src/shared/password.js';
import { normalizePhone } from '../src/shared/phone.js';
import { computeLineTotal, computeTotals } from '../src/modules/orders/orders.pricing.js';

/**
 * Datos de puesta en marcha de Pizzería Nuevo Quijote (Brazo Oriental,
 * Montevideo).
 *
 * QUÉ ES REAL Y QUÉ NO
 *
 * Del negocio se tomó lo que es público y verificable: el nombre, el barrio, el
 * rubro de la carta —pizzas, fainá, lehmeyún y sándwiches calientes— y que
 * atiende todos los días desde las 19:00.
 *
 * Todo lo demás es una PROPUESTA para reemplazar con los datos del comercio:
 * los precios son estimaciones de plaza, las zonas de envío son los barrios
 * linderos con tarifas a confirmar, y el teléfono y los datos bancarios son
 * marcadores a completar (ver docs/09).
 *
 * NADA de esto se inventa "por las dudas" en producción: el alias de
 * transferencia y el QR de Mercado Pago quedan vacíos a propósito, porque un
 * dato de cobro equivocado manda la plata del cliente a otro lado.
 *
 * El historial de pedidos y los clientes SÍ son ficticios: existen para que el
 * tablero y el dashboard tengan algo que mostrar el día de la demostración.
 */

const prisma = new PrismaClient();

const TIMEZONE = 'America/Montevideo';
const COUNTRY = 'UY';
/** Cierran de madrugada: el pedido de las 00:40 cuenta para el día anterior. */
const CUTOFF = '05:00';
const SLUG = 'nuevo-quijote';

const COMMERCE = {
  name: 'Pizzería Nuevo Quijote',
  /** Confirmado por el perfil público del negocio. */
  openingHours: 'todos los días desde las 19:00',
  /** Falta la altura exacta: completar antes de la demostración. */
  address: 'Av. Burgues, Brazo Oriental, Montevideo',
  /** MARCADOR: poner el número real del local. */
  phone: '+598 2 000 0000',
};

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

/** Precios en centésimos: $700 → 70000. */
const p = (pesos: number) => pesos * 100;

const PIZZA_SIZES = ['Chica (4 porciones)', 'Mediana (6 porciones)', 'Grande (8 porciones)'];

/**
 * La carta.
 *
 * Las categorías salen del rubro real del negocio: pizzas, fainá, lehmeyún y
 * sándwiches calientes. Los productos dentro de cada una y TODOS los precios son
 * una propuesta de arranque: se corrigen desde el panel en Menú, sin tocar
 * código, y conviene hacerlo con la carta del local al lado antes de mostrarlo.
 */
const MENU = [
  {
    category: 'Pizzas',
    products: [
      { name: 'Muzzarella', description: 'Salsa de tomate, muzzarella y aceitunas', prices: [420, 560, 700] },
      { name: 'Napolitana', description: 'Muzzarella, rodajas de tomate y ajo', prices: [480, 630, 780] },
      { name: 'Fugazzeta', description: 'Cebolla, muzzarella y orégano', prices: [500, 650, 810] },
      { name: 'Jamón y morrones', description: 'Muzzarella, jamón cocido y morrones asados', prices: [500, 650, 810] },
      { name: 'Calabresa', description: 'Muzzarella, longaniza calabresa y morrón', prices: [520, 680, 840] },
      { name: 'Especial', description: 'Muzzarella, jamón, morrones, huevo y aceitunas', prices: [540, 700, 870] },
      { name: 'Cuatro quesos', description: 'Muzzarella, dambo, parmesano y azul', prices: [560, 730, 900] },
      { name: 'Rúcula y jamón crudo', description: 'Muzzarella, rúcula fresca, jamón crudo y parmesano', prices: [600, 780, 960] },
    ],
    sizes: PIZZA_SIZES,
    modifierGroups: ['Extras para pizza', 'Punto de cocción'],
  },
  {
    category: 'Fainá',
    products: [
      { name: 'Fainá', description: 'A la piedra, bien fina', prices: [100, 280] },
      { name: 'Fainá con muzzarella', description: 'La clásica "a caballo"', prices: [160, 420] },
    ],
    sizes: ['Porción', 'Entera'],
    modifierGroups: [],
  },
  {
    category: 'Lehmeyún',
    products: [
      { name: 'Lehmeyún de carne', description: 'La clásica, con limón aparte', prices: [130, 720] },
      { name: 'Lehmeyún con muzzarella', description: 'Carne y muzzarella', prices: [160, 880] },
      { name: 'Lehmeyún de verdura', description: 'Espinaca y cebolla', prices: [130, 720] },
    ],
    sizes: ['Unidad', 'Media docena'],
    modifierGroups: [],
  },
  {
    category: 'Sándwiches calientes',
    products: [
      { name: 'Olímpico', description: 'Jamón, queso, lechuga, tomate, huevo y morrón', prices: [420] },
      { name: 'Húngara', description: 'Húngara, queso y aderezos', prices: [340] },
      { name: 'Chivito al pan', description: 'Lomo, panceta, jamón, queso, huevo y ensalada', prices: [620] },
      { name: 'Milanesa al pan', description: 'Con lechuga, tomate y mayonesa', prices: [480] },
      { name: 'Bondiola al pan', description: 'Con queso y morrones', prices: [520] },
    ],
    sizes: ['Único'],
    modifierGroups: [],
  },
  {
    category: 'Bebidas',
    products: [
      { name: 'Coca-Cola 1,5L', description: null, prices: [190] },
      { name: 'Coca-Cola 600ml', description: null, prices: [120] },
      { name: 'Sprite 1,5L', description: null, prices: [185] },
      { name: 'Agua mineral 600ml', description: null, prices: [90] },
      { name: 'Cerveza Patricia 1L', description: null, prices: [240] },
      { name: 'Cerveza Pilsen 960ml', description: null, prices: [230] },
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
      { name: 'Huevo', priceDeltaCents: p(60) },
      { name: 'Jamón', priceDeltaCents: p(90) },
      { name: 'Aceitunas', priceDeltaCents: p(50) },
      { name: 'Morrón', priceDeltaCents: p(55) },
      { name: 'Extra muzzarella', priceDeltaCents: p(110) },
      { name: 'Panceta', priceDeltaCents: p(120) },
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

/**
 * Zonas de reparto.
 *
 * Los barrios son los que rodean a Brazo Oriental sobre el eje de Av. Burgues,
 * ordenados por distancia al local. Las TARIFAS son una propuesta: hay que
 * confirmarlas con el comercio, y sobre todo hasta dónde reparten de verdad
 * (ver docs/09). Un barrio que no está en esta lista no recibe envío: el
 * asistente lo dice en vez de prometerlo.
 */
const DELIVERY_ZONES = [
  { name: 'Brazo Oriental', feeCents: p(100), estimatedMin: 20 },
  { name: 'Aires Puros', feeCents: p(110), estimatedMin: 25 },
  { name: 'Atahualpa', feeCents: p(120), estimatedMin: 25 },
  { name: 'Prado', feeCents: p(130), estimatedMin: 30 },
  { name: 'Reducto', feeCents: p(130), estimatedMin: 30 },
  { name: 'Cerrito de la Victoria', feeCents: p(150), estimatedMin: 35 },
  { name: 'Sayago', feeCents: p(160), estimatedMin: 35 },
  { name: 'Capurro', feeCents: p(170), estimatedMin: 40 },
];

/**
 * Promociones.
 *
 * Son texto, no reglas de descuento: es lo que el asistente le cuenta al cliente
 * y lo que el comercio edita solo desde Configuración. Estas tres son ejemplos
 * para la demostración; las reales las dicta el negocio.
 */
const PROMOTIONS = [
  {
    title: 'Martes de muzza 2x1',
    description: 'Todos los martes, dos pizzas de muzzarella grandes al precio de una.',
    weekdays: [2],
  },
  {
    title: 'Combo Quijote',
    description: 'Pizza grande + fainá entera + refresco de 1,5L. Pedilo por acá y te lo armamos.',
    weekdays: [],
  },
  {
    title: 'Envío sin costo en el barrio',
    description: 'De domingo a jueves, pedidos de más de $1.200 en Brazo Oriental y Aires Puros van sin costo de envío.',
    weekdays: [0, 1, 2, 3, 4],
  },
];

/**
 * Texto que ve el cliente mientras el comercio no cargó sus datos de cobro.
 *
 * Es deliberadamente visible: si alguien se olvida de completarlo, el error
 * salta en el primer pedido de prueba en vez de convertirse en una
 * transferencia perdida.
 */
const PENDIENTE_DE_CARGA =
  '⚠️ Faltan cargar los datos de cobro en el panel (Configuración → Métodos de pago).';

/**
 * Medios de pago.
 *
 * Los datos de cobro —alias, cuenta, QR— van vacíos A PROPÓSITO. Un alias
 * equivocado no es un detalle cosmético: manda la plata de un cliente a la
 * cuenta de otro. Se cargan desde el panel con los datos que dé el comercio, y
 * hasta entonces el asistente avisa que los tiene que pedir en vez de inventar
 * un número.
 */
const PAYMENT_METHODS = [
  {
    name: 'Efectivo',
    code: 'CASH',
    requiresChangeFor: true,
    requiresPrepayment: false,
    // Sólo en el local: cobrar efectivo en un envío implica que el cadete
    // maneje plata y vuelto.
    allowedOrderTypes: ['DINE_IN', 'TAKEAWAY'],
    instructions: null,
    qrImageUrl: null,
  },
  {
    name: 'Transferencia',
    code: 'TRANSFER',
    requiresChangeFor: false,
    requiresPrepayment: true,
    allowedOrderTypes: undefined,
    instructions: PENDIENTE_DE_CARGA,
    qrImageUrl: null,
  },
  {
    name: 'Mercado Pago',
    code: 'MP',
    requiresChangeFor: false,
    requiresPrepayment: true,
    allowedOrderTypes: undefined,
    instructions: PENDIENTE_DE_CARGA,
    qrImageUrl: null,
  },
  {
    name: 'Débito',
    code: 'DEBIT',
    requiresChangeFor: false,
    requiresPrepayment: false,
    allowedOrderTypes: ['DINE_IN', 'TAKEAWAY'],
    instructions: null,
    qrImageUrl: null,
  },
  {
    name: 'Crédito',
    code: 'CREDIT',
    requiresChangeFor: false,
    requiresPrepayment: false,
    allowedOrderTypes: ['DINE_IN', 'TAKEAWAY'],
    instructions: null,
    qrImageUrl: null,
  },
];

/**
 * Clientes de demostración.
 *
 * Ficticios, con direcciones en las zonas de reparto reales para que el tablero
 * y el historial se lean como un servicio de verdad. Los teléfonos no
 * corresponden a nadie.
 */
const CUSTOMERS = [
  { name: 'Martina Silva', phone: '099 123 456', street: 'Av. Burgues', number: '3140', apartment: 'Apto 2', neighborhood: 'Brazo Oriental', reference: 'Timbre 2, puerta gris' },
  { name: 'Diego Techera', phone: '094 567 890', street: 'Bvar. Aparicio Saravia', number: '2870', neighborhood: 'Aires Puros', reference: 'Casa con reja verde' },
  { name: 'Lucía Bentancur', phone: '091 234 567', street: 'Av. Millán', number: '3920', apartment: 'Apto 1A', neighborhood: 'Prado' },
  { name: 'Javier Sosa', phone: '098 765 432', street: 'Domingo Aramburú', number: '1450', neighborhood: 'Reducto', reference: 'Al lado del kiosco' },
  { name: 'Carolina Olivera', phone: '095 331 447', street: 'Av. Garzón', number: '1180', apartment: 'Apto 7C', neighborhood: 'Sayago' },
  { name: 'Nicolás Pereyra', phone: '092 884 210', street: 'Bvar. Batlle y Ordóñez', number: '3660', neighborhood: 'Atahualpa' },
  { name: 'Florencia Cabrera', phone: '096 118 903', street: 'Av. José Belloni', number: '2410', neighborhood: 'Cerrito de la Victoria', reference: 'Edificio azul, 2do piso' },
  { name: 'Sebastián Methol', phone: '099 776 331', street: 'Capurro', number: '840', neighborhood: 'Capurro' },
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
  const email = process.env.SEED_OWNER_EMAIL ?? 'admin@nuevoquijote.local';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'demo-quijote-2026';

  if (isProduction && !process.env.SEED_OWNER_PASSWORD) {
    throw new Error('En producción hay que definir SEED_OWNER_PASSWORD explícitamente.');
  }

  // La configuración regional se actualiza también en un comercio que ya
  // existe: si sólo se creara, volver a correr el seed dejaría un comercio
  // viejo con la moneda o la zona horaria equivocadas.
  const commerce = await prisma.commerce.upsert({
    where: { slug: SLUG },
    update: {
      name: COMMERCE.name,
      timezone: TIMEZONE,
      currency: 'UYU',
      country: COUNTRY,
      businessDayCutoff: CUTOFF,
      openingHours: COMMERCE.openingHours,
      phone: COMMERCE.phone,
      address: COMMERCE.address,
    },
    create: {
      name: COMMERCE.name,
      slug: SLUG,
      phone: COMMERCE.phone,
      address: COMMERCE.address,
      openingHours: COMMERCE.openingHours,
      timezone: TIMEZONE,
      currency: 'UYU',
      country: COUNTRY,
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
  await prisma.promotion.deleteMany({ where: { commerceId: commerce.id } });
  await prisma.conversation.deleteMany({ where: { commerceId: commerce.id } });

  // ---------- Equipo ----------

  const team = [
    { email, name: 'Dueño', role: 'OWNER' as const, password },
    { email: 'encargado@nuevoquijote.local', name: 'Encargada', role: 'MANAGER' as const, password: 'demo-quijote-2026' },
    { email: 'mostrador@nuevoquijote.local', name: 'Mostrador', role: 'STAFF' as const, password: 'demo-quijote-2026' },
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

  await Promise.all(
    PROMOTIONS.map((promotion, index) =>
      prisma.promotion.create({
        data: { ...promotion, commerceId: commerce.id, sortOrder: index },
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
          phoneE164: normalizePhone(customer.phone, COUNTRY),
          phoneRaw: customer.phone,
          // Clientes que ya escribieron por WhatsApp: es lo que habilita
          // responderles sin plantilla aprobada, y permite ver los avisos
          // funcionando en la demostración.
          lastInboundAt: new Date(),
          addresses: {
            create: {
              commerceId: commerce.id,
              label: 'Casa',
              street: customer.street,
              number: customer.number,
              apartment: 'apartment' in customer ? (customer.apartment ?? null) : null,
              neighborhood: customer.neighborhood,
              city: 'Montevideo',
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
        paymentStatus: status === 'ENTREGADO' ? 'CONFIRMED' : 'NOT_REQUIRED',
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

  // Dos pedidos que llegaron por WhatsApp y están esperando el pago: uno sin
  // comprobante todavía y otro con comprobante a verificar. Es lo que hace
  // visible el flujo de cobro previo en la demostración.
  const transfer = paymentMethods.find((m) => m.code === 'TRANSFER')!;
  for (const [index, paymentStatus] of (['PENDING', 'PROOF_SUBMITTED'] as const).entries()) {
    const placedAt = new Date(now.getTime() - (index + 1) * 4 * 60 * 1000);
    const businessDate = businessDateOf(placedAt, TIMEZONE, CUTOFF);
    const customer = customers[index]!;
    const variant = pizzaVariants[index]!;

    const order = await prisma.order.create({
      data: {
        commerceId: commerce.id,
        number: nextNumber(businessDate),
        businessDate: toDateColumn(businessDate),
        type: 'TAKEAWAY',
        status: 'PENDIENTE',
        source: 'WHATSAPP',
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phoneE164,
        paymentMethodId: transfer.id,
        paymentMethodName: transfer.name,
        paymentStatus,
        subtotalCents: variant.priceCents,
        deliveryFeeCents: 0,
        discountCents: 0,
        totalCents: variant.priceCents,
        placedAt,
        items: {
          create: {
            commerceId: commerce.id,
            productId: variant.productId,
            variantId: variant.id,
            productName: variant.productName,
            variantName: variant.name,
            unitPriceCents: variant.priceCents,
            quantity: 1,
            lineTotalCents: variant.priceCents,
          },
        },
        statusHistory: {
          create: { commerceId: commerce.id, fromStatus: null, toStatus: 'PENDIENTE' },
        },
      },
    });

    if (paymentStatus === 'PROOF_SUBMITTED') {
      await prisma.paymentProof.create({
        data: {
          commerceId: commerce.id,
          orderId: order.id,
          whatsappMediaId: 'wamid.demo',
          mimeType: 'image/jpeg',
          note: 'Transferencia realizada',
        },
      });
    }
  }

  // ---------- Conversaciones de WhatsApp ----------
  //
  // Dos hilos que muestran el asistente en las dos situaciones que importan:
  // una charla que terminó en un pedido esperando pago, y una que el asistente
  // derivó a una persona en vez de improvisar.

  await seedConversation({
    commerceId: commerce.id,
    customer: customers[0]!,
    status: 'BOT',
    minutesAgo: 6,
    messages: [
      ['CUSTOMER', 'Hola! tenés muzza grande?'],
      [
        'ASSISTANT',
        '¡Hola! 👋 Sí, tenemos. La muzzarella grande (8 porciones) está $700.\n\n¿Te la armo? Decime si es para envío o para retirar.',
      ],
      ['CUSTOMER', 'dale, una grande para retirar'],
      [
        'ASSISTANT',
        'Te va quedando así:\n• 1x Muzzarella (Grande (8 porciones)) — $700\n*Total: $700*\n\n¿Cómo lo vas a pagar?',
      ],
      ['CUSTOMER', 'transferencia'],
      [
        'ASSISTANT',
        'Te va quedando así:\n• 1x Muzzarella (Grande (8 porciones)) — $700\n*Total: $700*\n\n¿Confirmo el pedido?',
      ],
      ['CUSTOMER', 'si'],
      [
        'ASSISTANT',
        `¡Listo! Tu pedido es el *#42* por $700.\n\nPara ponerlo en marcha necesitamos el pago por adelantado.\n\n${PENDIENTE_DE_CARGA}\n\nCuando pagues, mandame la captura del comprobante por acá y lo mandamos a la cocina 👍`,
      ],
    ],
  });

  await seedConversation({
    commerceId: commerce.id,
    customer: customers[3]!,
    status: 'HUMAN',
    handoffReason: 'El cliente pidió hablar con una persona',
    minutesAgo: 25,
    messages: [
      ['CUSTOMER', 'buenas, el pedido de ayer llegó frío'],
      ['ASSISTANT', 'Te paso con alguien del local, en un ratito te responden 🙌'],
    ],
  });

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
  console.log('');
  console.log('ANTES DE MOSTRARLO, completar con los datos del comercio:');
  console.log('  1. Precios de la carta            → panel · Menú');
  console.log('  2. Alias / cuenta y QR de cobro   → panel · Configuración');
  console.log('  3. Zonas de reparto y sus costos  → panel · Configuración');
  console.log('  4. Teléfono y dirección exacta    → panel · Configuración');
  console.log('  La lista completa está en docs/09-nuevo-quijote.md');
}

/** Deja un hilo de WhatsApp ya conversado, para poder mostrarlo sin escribirlo. */
async function seedConversation(input: {
  commerceId: number;
  customer: { id: number; name: string; phoneE164: string };
  status: 'BOT' | 'HUMAN';
  handoffReason?: string;
  minutesAgo: number;
  messages: ['CUSTOMER' | 'ASSISTANT', string][];
}): Promise<void> {
  const start = new Date(Date.now() - input.minutesAgo * 60 * 1000);
  const lastMessageAt = new Date(start.getTime() + input.messages.length * 40 * 1000);

  const conversation = await prisma.conversation.create({
    data: {
      commerceId: input.commerceId,
      channel: 'WHATSAPP',
      phoneE164: input.customer.phoneE164,
      customerId: input.customer.id,
      contactName: input.customer.name,
      status: input.status,
      handoffReason: input.handoffReason ?? null,
      lastMessageAt,
    },
  });

  for (const [index, [role, body]] of input.messages.entries()) {
    await prisma.conversationMessage.create({
      data: {
        commerceId: input.commerceId,
        conversationId: conversation.id,
        role,
        body,
        // Separados en el tiempo para que el hilo se lea como una charla y no
        // como ocho mensajes escritos en el mismo segundo.
        createdAt: new Date(start.getTime() + index * 40 * 1000),
      },
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
