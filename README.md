# AutoElite — Plataforma de gestión de pedidos para gastronomía

Plataforma de gestión de pedidos para comercios gastronómicos, con un piloto inicial en una
pizzería y un agente de IA sobre WhatsApp en fases posteriores.

**Estado actual: fase 1 en curso.** Las etapas 1.1 (andamiaje) y 1.2 (autenticación y aislamiento
multi-tenant) están implementadas. El catálogo, los clientes y los pedidos vienen después; el modelo
del catálogo está bloqueado a propósito hasta tener las respuestas del bloque A de
[docs/07](docs/07-preguntas-para-la-pizzeria.md).

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

## Puesta en marcha

Requiere Node 20+, pnpm y Docker (o un MySQL 8 accesible).

```bash
pnpm install
cp .env.example .env          # completar DATABASE_URL y los secretos
pnpm db:up                    # levanta MySQL con docker compose
pnpm --filter @autoelite/api db:migrate
pnpm --filter @autoelite/api db:seed
pnpm dev                      # API en http://localhost:3000
```

El seed crea el comercio piloto y un usuario `OWNER`. La contraseña inicial se imprime en consola y
hay que cambiarla en el primer login; en producción se exige definir `SEED_OWNER_PASSWORD`.

Para los tests hace falta una base aparte y su propio `.env.test`:

```bash
pnpm --filter @autoelite/api db:test:deploy
pnpm test
```

## Estructura

```
apps/api            Backend Express + Prisma (núcleo del producto)
packages/shared     Tipos y esquemas Zod del contrato, compartidos con el frontend
docs/               Análisis, arquitectura y plan por fases
```

## Cómo seguir

1. Responder las decisiones abiertas del documento 01, sección 3.
2. Llevar el bloque A del cuestionario del documento 07 a la pizzería: bloquea la etapa 1.3.
3. Seguir con el catálogo (1.3), clientes (1.4) y pedidos (1.5).
