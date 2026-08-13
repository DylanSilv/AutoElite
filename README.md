# AutoElite — Plataforma de gestión de pedidos para gastronomía

Plataforma de gestión de pedidos para comercios gastronómicos, con un piloto inicial en una
pizzería y un agente de IA sobre WhatsApp en fases posteriores.

**Estado actual: MVP funcional.** El sistema permite operar una pizzería de punta a punta: cargar
pedidos, seguirlos por estado, gestionar menú y clientes, y ver métricas. Viene con datos de
demostración —realistas pero ficticios— para poder mostrarlo funcionando.

Lo que sigue después del MVP está en [docs/06](docs/06-mvp.md): WhatsApp y el agente de IA (fase 2),
audios (fase 3) y telefonía (fase 4).

## Principio rector

La API propia es el núcleo del producto. n8n es una capa de integración reemplazable y el modelo de
IA es un detalle de implementación intercambiable. Ninguna regla de negocio vive fuera del backend.

## Documentación

| Documento | Contenido |
|---|---|
| [01 — Análisis y decisiones](docs/01-analisis-y-decisiones.md) | Qué está bien planteado, qué problemas veo y qué decisiones faltan definir |
| [02 — Arquitectura](docs/02-arquitectura.md) | Componentes, límites, contratos y cómo se evita el acoplamiento a n8n / al proveedor de IA |
| [03 — Modelo de datos](docs/03-modelo-de-datos.md) | Entidades, diagrama, esquema Prisma propuesto y reglas de integridad |
| [04 — Estructura del backend](docs/04-estructura-backend.md) | Organización modular, capas, convenciones y diseño de la API REST |
| [05 — Estructura del frontend](docs/05-estructura-frontend.md) | Organización por features, pantallas del MVP y manejo de estado |
| [06 — MVP y fases](docs/06-mvp.md) | Alcance cerrado de la fase 1, qué queda explícitamente afuera y el plan por etapas |
| [07 — Preguntas para la pizzería](docs/07-preguntas-para-la-pizzeria.md) | Lo que hay que validar con el comercio antes de escribir determinado código |

## Funcionalidad

| Módulo | Qué hace |
|---|---|
| **Tablero de pedidos** | Columnas por estado, con antigüedad de cada pedido y avance en un toque |
| **Alta de pedido** | Todo en una vista: reconoce al cliente por teléfono, arma el pedido y muestra el total calculado por el backend |
| **Menú** | Productos con tamaños y extras; corte de disponibilidad durante el servicio |
| **Clientes** | Ficha con direcciones, cantidad de pedidos y total gastado, alimentada sola |
| **Historial** | Filtros por estado, modalidad y texto |
| **Dashboard** | Ventas, cantidad de pedidos, ticket promedio, más vendidos y distribución por modalidad y pago |
| **Configuración** | Comercio, zonas de envío, métodos de pago y usuarios |

## Puesta en marcha (desarrollo)

Requiere Node 20+, pnpm y Docker (o un MySQL 8 accesible).

```bash
pnpm install
cp .env.example .env    # sirve tal cual para desarrollo local
pnpm db:up              # levanta MySQL con docker compose
pnpm db:setup           # genera el cliente, migra y carga los datos de demo
```

Después, en dos terminales:

```bash
pnpm dev        # API en http://localhost:3000
pnpm dev:web    # panel en http://localhost:5173
```

`db:setup` carga el menú, las zonas, los clientes y dos semanas de historial, e imprime en consola el
usuario y la contraseña de acceso. Se puede volver a correr cuando se quiera: limpia y recarga sólo
los datos operativos del comercio de demostración.

Para los tests hace falta una base aparte y su propio `.env.test`:

```bash
pnpm --filter @autoelite/api db:test:deploy
pnpm test
```

## Despliegue

```bash
cp .env.prod.example .env.prod    # completar secretos: openssl rand -base64 48
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api node dist/seed.js
```

El panel queda en `http://localhost` y habla con la API por el mismo origen a través de nginx, así
que no hace falta exponer el puerto de la API. Las migraciones se aplican al arrancar el contenedor,
como paso explícito.

**Antes de exponerlo a internet:** poner HTTPS delante y `COOKIE_SECURE=true`, o la cookie de sesión
viaja en claro.

## Estructura

```
apps/api            Backend Express + Prisma (núcleo del producto)
apps/web            Panel React + Vite
packages/shared     Tipos y esquemas Zod del contrato, compartidos por ambos
docs/               Análisis, arquitectura y plan por fases
```

## Datos de demostración

El menú, los clientes y el historial son ficticios pero con la forma del negocio real. Cuando la
pizzería se sume, se reemplazan por los suyos: el seed limpia y recarga sólo los datos operativos.

Hay una decisión de modelo que quedó abierta a propósito y conviene cerrar antes de cargar datos
reales: **la pizza mitad y mitad**. Está en el bloque A de
[docs/07](docs/07-preguntas-para-la-pizzeria.md), junto con el resto de lo que hay que validar con el
comercio.
