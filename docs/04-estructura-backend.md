# 04 — Estructura del backend

## 1. Organización del repositorio

Monorepo con workspaces de pnpm. El motivo principal es `packages/shared`: los esquemas Zod del
contrato de la API se escriben una vez y los usan el backend para validar y el frontend para tipar.

```
AutoElite/
├── apps/
│   ├── api/          Backend Express + Prisma
│   └── web/          Panel React + Vite
├── packages/
│   └── shared/       Tipos y esquemas Zod compartidos
├── docs/
└── docker-compose.yml
```

## 2. Estructura de `apps/api`

```
apps/api/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts               Comercio piloto, usuario admin, métodos de pago, menú de ejemplo
├── src/
│   ├── config/
│   │   └── env.ts            Variables de entorno validadas con Zod al arrancar
│   ├── db/
│   │   ├── prisma.ts         Cliente único
│   │   └── tenant-extension.ts  Inyecta el filtro por commerceId
│   ├── http/
│   │   ├── app.ts            Ensamblado de Express
│   │   ├── server.ts         Arranque y apagado ordenado
│   │   ├── router.ts         Montaje de /api/v1
│   │   ├── middlewares/
│   │   │   ├── authenticate.ts     JWT (personas) y API key (máquinas)
│   │   │   ├── authorize.ts        Roles y scopes
│   │   │   ├── tenant-context.ts   Resuelve el comercio desde el token
│   │   │   ├── validate.ts         Valida body/query/params con Zod
│   │   │   ├── idempotency.ts
│   │   │   ├── rate-limit.ts
│   │   │   ├── request-id.ts
│   │   │   └── error-handler.ts    Único punto donde se traduce error → HTTP
│   │   └── openapi.ts        Documento generado desde los esquemas Zod
│   ├── modules/
│   │   ├── auth/
│   │   ├── commerces/
│   │   ├── users/
│   │   ├── categories/
│   │   ├── products/
│   │   ├── modifiers/
│   │   ├── customers/
│   │   ├── orders/
│   │   ├── payment-methods/
│   │   ├── delivery-zones/
│   │   └── reports/
│   └── shared/
│       ├── errors.ts         AppError y subclases de dominio
│       ├── money.ts          Aritmética en centavos y formateo
│       ├── phone.ts          Normalización a E.164
│       ├── business-date.ts  Día operativo según zona horaria y corte
│       ├── pagination.ts     Paginación por cursor
│       └── logger.ts         Pino con requestId
└── tests/
    ├── integration/
    └── tenant-isolation.test.ts
```

Cada módulo tiene la misma forma:

```
modules/orders/
├── orders.routes.ts       Define rutas, aplica middlewares
├── orders.controller.ts   HTTP: lee el request, llama al service, arma la respuesta
├── orders.service.ts      Reglas de negocio. No conoce Express
├── orders.repository.ts   Acceso a datos. Único lugar con Prisma
├── orders.schema.ts       Esquemas Zod de entrada y salida
├── orders.mapper.ts       Entidad de Prisma → DTO de la API
├── orders.state-machine.ts  Transiciones válidas por tipo de pedido
├── orders.pricing.ts      Cálculo de totales (función pura)
└── orders.service.test.ts
```

## 3. Las tres reglas de capas

1. **El controller no toca Prisma.** Si lo hace, esa lógica queda inalcanzable para cualquier otro
   llamador y el módulo deja de ser testeable sin HTTP.
2. **El service no conoce `req` ni `res`.** Recibe datos ya validados y un contexto
   (`{ commerceId, actor }`), y devuelve datos o lanza errores de dominio. Esta es la regla que hace
   que el agente de IA de la fase 2 pueda reutilizar exactamente la misma lógica.
3. **El repository no decide nada.** Consulta y persiste; no valida reglas de negocio.

La consecuencia práctica: cuando llegue la fase 2, la herramienta `crear_pedido()` del agente termina
llamando al mismo `ordersService.create()` que usa el panel. No hay una segunda implementación que se
desincronice.

## 4. Aislamiento multi-tenant

```ts
// db/tenant-extension.ts (esbozo)
const TENANT_MODELS = ['Product', 'Category', 'Customer', 'Order', /* ... */] as const;

export function forCommerce(commerceId: number) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.includes(model as never)) return query(args);
          if (isReadOrUpdate(operation)) {
            args.where = { ...args.where, commerceId };
          }
          if (isCreate(operation)) {
            args.data = { ...args.data, commerceId };
          }
          return query(args);
        },
      },
    },
  });
}
```

El `commerceId` llega siempre del token, nunca de la URL ni del body. Un `PLATFORM_ADMIN` que
necesite operar sobre un comercio ajeno usa un cliente explícito y auditado, no un parámetro
opcional.

Los tests de aislamiento son parte de la definición de "terminado" de la fase 1: se crean dos
comercios con datos y se verifica que ninguna ruta devuelva datos cruzados.

## 5. Diseño de la API

Prefijo `/api/v1`. Todos los identificadores en las URLs son `publicId`.

### Autenticación

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/login` | Devuelve access token y setea el refresh en cookie |
| POST | `/auth/refresh` | Rota el refresh token |
| POST | `/auth/logout` | Revoca el refresh token |
| GET | `/auth/me` | Usuario actual, comercio y permisos |

### Catálogo

| Método | Ruta | Notas |
|---|---|---|
| GET/POST | `/categories`, `/categories/:id` | ABM, con reordenamiento |
| GET/POST | `/products`, `/products/:id` | Filtros por categoría, disponibilidad y búsqueda por nombre |
| PATCH | `/products/:id/availability` | Cortar un producto en un clic durante el servicio |
| GET/POST | `/products/:id/variants` | Variantes con precio |
| GET/POST | `/modifier-groups` | Extras y opciones |

`GET /products?search=muzza` es el endpoint que va a usar la herramienta `buscar_productos()` del
agente. No hace falta construir nada especial para el agente: se construye bien para el panel y sirve
para ambos.

### Clientes

| Método | Ruta | Notas |
|---|---|---|
| GET | `/customers?phone=+549...` | Búsqueda por teléfono normalizado, usada por `buscar_cliente()` |
| GET/POST | `/customers`, `/customers/:id` | ABM con agregados |
| GET | `/customers/:id/orders` | Historial del cliente |
| GET/POST | `/customers/:id/addresses` | Direcciones |

### Pedidos

| Método | Ruta | Notas |
|---|---|---|
| POST | `/orders/quote` | Calcula totales sin persistir. Lo usan el panel y el agente |
| POST | `/orders` | Crea el pedido. Acepta `Idempotency-Key` |
| GET | `/orders` | Filtros por estado, tipo, fecha, cliente, origen; paginación por cursor |
| GET | `/orders/today` | Vista operativa del día operativo actual, agrupada por estado |
| GET | `/orders/:id` | Detalle completo con items, modificadores e historial |
| PATCH | `/orders/:id` | Edita datos del pedido mientras el estado lo permita |
| POST | `/orders/:id/status` | `{ from, to, note }`. Devuelve `409` si `from` no coincide |
| POST | `/orders/:id/cancel` | Exige motivo |

### Configuración y métricas

| Método | Ruta |
|---|---|
| GET/PATCH | `/commerce` (datos y ajustes del comercio propio) |
| GET/POST | `/payment-methods`, `/delivery-zones` |
| GET/POST | `/users` (solo `OWNER` / `MANAGER`) |
| GET | `/reports/dashboard?from=&to=` |
| GET | `/reports/top-products?from=&to=&limit=` |

### Convenciones

- **Respuestas de error uniformes**, generadas en un único middleware:

```json
{
  "error": {
    "code": "INVALID_STATUS_TRANSITION",
    "message": "No se puede pasar de PENDIENTE a ENTREGADO",
    "details": { "currentStatus": "PENDIENTE", "allowed": ["CONFIRMADO", "CANCELADO"] },
    "requestId": "01J8X..."
  }
}
```

  El `code` es estable y legible por máquina: es lo que le permite al agente de la fase 2 reaccionar
  a un error ("ese producto no está disponible") en lugar de improvisar sobre un texto en prosa.

- **Listados con paginación por cursor**, nunca `offset`, para que el polling y el scroll infinito no
  se rompan cuando entran pedidos nuevos.
- **Dinero siempre en centavos** en el JSON, con el nombre del campo terminado en `Cents`.
- **Fechas en ISO 8601 UTC.** La conversión a hora local la hace el cliente con la zona del comercio.
- **`PATCH` parcial, `POST` para acciones** que no son un simple cambio de campo (cambio de estado,
  cancelación).

## 6. Manejo de errores

Una jerarquía chica de errores de dominio (`NotFoundError`, `ValidationError`, `ConflictError`,
`ForbiddenError`, `BusinessRuleError`), lanzados desde los services. El middleware de errores es el
único lugar que conoce códigos HTTP. Los errores no controlados se loguean completos con su
`requestId` y se responden como `500` genérico, sin filtrar detalles internos.

## 7. Variables de entorno

Validadas con Zod al arrancar; si falta una, el proceso no levanta.

| Variable | Uso |
|---|---|
| `NODE_ENV` | Entorno |
| `PORT` | Puerto HTTP |
| `DATABASE_URL` | Conexión MySQL |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Firma de tokens |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | Vigencias |
| `CORS_ORIGINS` | Orígenes permitidos del panel |
| `LOG_LEVEL` | Nivel de log |

Se versiona un `.env.example`; nunca un `.env`.

## 8. Testing

| Nivel | Alcance |
|---|---|
| Unitario | Cálculo de totales, máquina de estados, normalización de teléfonos, día operativo |
| Integración | Rutas contra MySQL de test, con Supertest |
| Aislamiento | Suite dedicada que verifica que ningún endpoint filtre datos entre comercios |

El cálculo de totales y la máquina de estados son las dos piezas donde un bug se traduce
directamente en plata mal cobrada o comida mal despachada; ahí la cobertura tiene que ser real.
