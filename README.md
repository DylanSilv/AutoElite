# AutoElite — Plataforma de gestión de pedidos para gastronomía

Plataforma de gestión de pedidos para comercios gastronómicos, con un piloto inicial en una
pizzería y un agente de IA sobre WhatsApp en fases posteriores.

**Estado actual: fase de diseño.** Todavía no hay código de aplicación. Este repositorio contiene,
por ahora, el análisis y las propuestas de arquitectura que hay que revisar y aprobar antes de
empezar a implementar.

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

## Cómo seguir

1. Revisar los documentos, empezando por el 01 y el 06.
2. Responder las decisiones abiertas marcadas como **DECISIÓN PENDIENTE**.
3. Llevar el cuestionario del documento 07 a la pizzería.
4. Recién ahí, arrancar la implementación por etapas.
