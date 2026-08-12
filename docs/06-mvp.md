# 06 — Definición del MVP y plan por fases

## 1. Criterio de éxito

> Que la pizzería pueda pasar un viernes a la noche completo usando el sistema en lugar del papel,
> y no quiera volver atrás.

Ese es el único criterio que importa. No es "tener las pantallas listas": es que el sistema aguante
un servicio real. De ahí se desprende todo lo que entra y todo lo que queda afuera.

## 2. Alcance de la fase 1

### Incluido

| # | Funcionalidad | Detalle |
|---|---|---|
| 1 | Autenticación | Login, refresh, logout, cambio de contraseña |
| 2 | Comercios | Un comercio piloto, con datos, zona horaria y corte del día operativo |
| 3 | Usuarios y roles | `OWNER`, `MANAGER`, `STAFF` con permisos diferenciados |
| 4 | Categorías | ABM con orden |
| 5 | Productos y variantes | ABM, precios, disponibilidad, imagen opcional |
| 6 | Modificadores | Modelo y API completos; UI mínima |
| 7 | Clientes | ABM, teléfono normalizado a E.164, direcciones, agregados |
| 8 | Métodos de pago | Configurables por comercio |
| 9 | Zonas de envío | Nombre y costo fijo, con override manual en el pedido |
| 10 | Creación manual de pedidos | Los tres tipos, con cotización en vivo |
| 11 | Panel de pedidos | Tablero por estado con polling |
| 12 | Cambio de estado | Con validación de transición e historial |
| 13 | Detalle y edición | Mientras el estado lo permita; cancelación con motivo |
| 14 | Historial | Filtros y paginación por cursor |
| 15 | Dashboard | Ventas del día, cantidad de pedidos, ticket promedio, productos más vendidos, pedidos por modalidad y por método de pago, ventas por período |
| 16 | API REST documentada | OpenAPI generado desde los esquemas |
| 17 | Aislamiento multi-tenant | Con suite de tests que lo verifica |

### Explícitamente afuera de la fase 1

Cada exclusión es deliberada, no un olvido:

| Queda afuera | Motivo |
|---|---|
| WhatsApp y agente de IA | Es la fase 2. Construirlo sin un dominio de pedidos probado es construirlo dos veces |
| Tiempo real (WebSockets/SSE) | El polling alcanza de sobra para este volumen. Se agrega si la operación lo pide |
| Impresión de comandas | Depende de qué hardware tenga la pizzería (ver documento 07) |
| Promociones, combos y cupones | Requiere reglas de negocio que todavía no conocemos. Por ahora, descuento manual |
| Control de stock | Alcanza con el flag de disponibilidad |
| Facturación fiscal | Un pedido no es un comprobante. Módulo aparte si alguna vez hace falta |
| App móvil | El panel responsive cubre el caso |
| Web pública de pedidos | Requiere autenticación de cliente final y un flujo distinto |
| Onboarding de nuevos comercios | El aislamiento está; la autogestión no hace falta con un piloto |
| Notificaciones al cliente | Depende de WhatsApp, o sea de la fase 2 |
| Reparto y cadetes | No sabemos aún si tienen cadetes propios (ver documento 07) |

## 3. Plan de implementación de la fase 1

Siete etapas, cada una entregable y verificable. No se avanza a la siguiente sin que la anterior
funcione de punta a punta.

| Etapa | Contenido | Resultado observable |
|---|---|---|
| ~~1.1~~ ✅ | Andamiaje: monorepo, Prisma, Docker Compose, config validada, logger, manejo de errores, salud | `docker compose up` levanta API y base |
| ~~1.2~~ ✅ | Autenticación y multi-tenant: usuarios, roles, JWT, API keys, extensión de Prisma, **tests de aislamiento** | Se puede iniciar sesión y ninguna ruta filtra datos |
| 1.3 | Catálogo: categorías, productos, variantes, modificadores, seed del menú | El menú de la pizzería está cargado y consultable |
| 1.4 | Clientes: ABM, normalización E.164, direcciones, zonas de envío | Se puede buscar un cliente por teléfono |
| 1.5 | Pedidos (backend): cotización, creación con idempotencia, máquina de estados, historial, listados | Se crea y se avanza un pedido completo por API |
| 1.6 | Panel web: login, tablero, nuevo pedido, detalle, historial, ABMs | La pizzería puede operar |
| 1.7 | Dashboard, OpenAPI, seed de demo, despliegue de staging | Listo para prueba real |

Las etapas 1.2 y 1.5 son las que definen la calidad del producto. Si hay que ir más lento en algún
lado, es ahí.

**Antes de la etapa 1.3 hacen falta las respuestas del documento 07**, porque el modelo del catálogo
depende de ellas (mitad y mitad, tamaños, extras).

## 4. Puesta en marcha del piloto

No termina cuando el código está desplegado:

1. Cargar el menú real completo, con precios verificados.
2. Cargar zonas de envío y métodos de pago reales.
3. Crear los usuarios del personal.
4. Media hora de capacitación sobre la pantalla de carga de pedidos.
5. **Una noche en paralelo con el papel.** Sirve para encontrar lo que no se pensó, y para que el
   personal confíe en el sistema.
6. Recién después, apagar el papel.

Un piloto que se corta acá es un piloto que fracasa aunque el software esté perfecto.

## 5. Fases siguientes

### Fase 2 — WhatsApp y agente de IA

- Integración con WhatsApp Business API vía n8n.
- Servicio de agente con la interfaz `LlmProvider`, con Gemini como primera implementación.
- Persistencia de conversaciones en nuestra base de datos.
- Herramientas: `buscar_productos`, `consultar_producto`, `buscar_cliente`, `calcular_envio`,
  `cotizar_pedido`, `crear_pedido`, `consultar_estado_pedido`.
- API keys con scopes para el agente, con auditoría de cada acción.
- Panel de conversaciones para que el personal vea qué está haciendo el agente y pueda intervenir.

**Precondición:** el trámite de WhatsApp Business API tiene semanas de latencia y una decisión
irreversible sobre el número de teléfono. Conviene arrancarlo durante la fase 1, en paralelo.

**Regla de oro de esta fase:** el agente no debe poder hacer nada que no pueda hacerse por la API
pública. Si hace falta un atajo, es que falta un endpoint.

### Fase 3 — IA avanzada

Audios con speech-to-text, modificación y cancelación de pedidos por el agente, consulta de estado,
derivación a humano con criterios claros, memoria de contexto entre conversaciones.

Antes de dejar que el agente modifique o cancele pedidos, hace falta que la fase 2 haya demostrado
que crea pedidos correctamente. El costo de un error crece mucho en esta fase.

### Fase 4 — Telefonía

Llamadas con VoIP, speech-to-text, text-to-speech. Un canal más sobre la misma arquitectura: si las
fases anteriores se hicieron bien, no requiere tocar el dominio.

## 6. Riesgos del plan

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El modelo del catálogo no contempla cómo vende realmente la pizzería | Alto | Cuestionario del documento 07 antes de la etapa 1.3 |
| El personal no adopta el sistema | Alto | Optimizar la carga de pedidos; noche en paralelo con papel |
| Trámite de WhatsApp más lento de lo previsto | Medio | Arrancarlo durante la fase 1 |
| Expectativa de que el agente resuelva todo desde el día 1 | Medio | Fases explícitas y acordadas con el comercio |
| Precios desactualizados en el sistema | Medio | Edición rápida de precios y snapshot en pedidos |
| Crecimiento del alcance durante la fase 1 | Alto | La lista de exclusiones de la sección 2 es un acuerdo, no una sugerencia |
