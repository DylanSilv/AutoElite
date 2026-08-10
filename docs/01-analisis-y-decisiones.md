# 01 — Análisis de la idea y decisiones pendientes

## 1. Lectura general

La idea está bien planteada y el instinto arquitectónico principal es correcto: **poner la API propia
en el centro y tratar a n8n y al modelo de IA como periferia reemplazable**. Ese es exactamente el
error que hunde a la mayoría de estos proyectos (toda la lógica adentro de nodos de n8n, imposible de
testear, versionar y migrar), y ya está identificado.

También es correcto arrancar por el MVP manual. El agente de WhatsApp es el diferencial comercial,
pero no se puede construir un agente que "cree pedidos" antes de que exista un dominio de pedidos
sólido. La fase 1 no es un rodeo: es el cimiento del agente.

Tres cosas que veo bien y no hay que tocar:

- Separación frontend / backend / base de datos con la API como contrato único.
- Multi-tenant desde el diseño, aunque el piloto sea un solo comercio. Retrofitear multi-tenancy es
  de las migraciones más caras que existen.
- Trabajar por fases, con el agente usando herramientas contra la API en lugar de inventar datos.

El resto de este documento es lo que **no** está definido y hay que resolver antes de escribir código.

---

## 2. Problemas y riesgos concretos

### 2.1 El modelo del catálogo es la decisión más cara de revertir

El ejemplo del enunciado —"Muzzarella chica / mediana / grande"— admite tres modelados distintos y
la elección impacta el pedido, el panel, el dashboard y el agente:

| Opción | Cómo se ve | Costo |
|---|---|---|
| (a) Producto plano | "Muzzarella grande" es un producto independiente | Catálogo enorme, precios duplicados, métricas rotas ("¿cuánta muzzarella vendí?" requiere sumar 3 filas) |
| (b) Producto + variantes | "Muzzarella" con variantes chica/mediana/grande, cada una con su precio | Un nivel más de tablas, pero es el modelo natural del rubro |
| (c) Producto + variantes + modificadores | Además "extras: huevo, jamón", "sin cebolla" | Necesario tarde o temprano, pero agrega reglas (mín/máx, precio delta) |

**Recomendación:** (b) obligatorio en el MVP, con (c) presente en el esquema desde el día 1 pero con
UI mínima. Todo producto tiene al menos una variante (si no tiene tamaños, una variante "Única"),
así el pedido siempre referencia una variante y no hay dos caminos de código.

El caso que puede romper el modelo es la **pizza mitad y mitad**, que en Argentina es habitual y no
entra en "un item = una variante". Está en el cuestionario del documento 07 porque hay que
preguntarlo antes de cerrar el esquema, no después.

### 2.2 Los precios del pedido tienen que ser una foto, no una referencia

Si `order_item` solo guarda `product_id` y el precio se lee del catálogo, subir el precio de la
muzzarella **reescribe el pasado**: el pedido de hace tres meses pasa a valer otra cosa y el
dashboard miente. En un país con la inflación que tenemos, esto deja de ser teórico en semanas.

Cada línea del pedido debe guardar copia de: nombre del producto, nombre de la variante, precio
unitario, cantidad y precio de cada modificador. La FK al producto se conserva solo para reportes
("productos más vendidos") y puede quedar en `NULL` si el producto se borra.

### 2.3 El dinero no puede ser `float`

`0.1 + 0.2 !== 0.3`. Dos caminos válidos:

- `DECIMAL(12,2)` en MySQL, que Prisma expone como `Decimal` y hay que serializar como string.
- Enteros en centavos (`totalCents INT`), aritmética exacta en JS y formateo solo en la UI.

**Recomendación: enteros en centavos.** Evita que un `JSON.stringify` convierta un `Decimal` en algo
raro, evita dependencias de decimal en el frontend y hace que el contrato de la API sea trivial de
consumir desde n8n o desde el agente. El costo es acordarse de dividir por 100 al mostrar, que se
encapsula en un único helper.

**DECISIÓN PENDIENTE:** centavos enteros (recomendado) vs `Decimal`.

### 2.4 El teléfono es la llave del cliente, y hoy no está normalizado

En la fase 2, WhatsApp entrega el número en formato E.164 (`+5491134567890`). Si durante meses el
personal cargó `15 3456-7890`, `11 3456 7890` y `(011) 4567-8901`, el agente no va a poder
reconocer al cliente que ya existe y se van a duplicar clientes e historiales.

Normalizar a E.164 **desde el MVP**, con índice único `(commerce_id, phone_e164)`, y guardar aparte
lo que tipeó el operador. Es una línea de código hoy y una migración con limpieza manual de datos
después.

### 2.5 Los estados son una máquina de estados, no una lista

Los siete estados propuestos mezclan flujos: `EN_CAMINO` no aplica a un pedido para comer en el
local, y `LISTO` significa "salió del horno" en salón pero "esperando al cadete" en delivery. Sin
transiciones válidas explícitas, cualquiera va a poder pasar un pedido de `PENDIENTE` a `ENTREGADO`
por un clic mal dado, y no se va a poder auditar.

Propuesta:

- Estados como enum en código, no como tabla configurable por comercio. Evolucionan bien con una
  migración; una tabla configurable agrega complejidad sin resolver ningún problema de hoy.
- Transiciones válidas declaradas en el backend y dependientes del tipo de pedido.
- Tabla `order_status_history` desde el MVP: quién, cuándo, de qué estado a cuál. Sin eso no hay
  auditoría ni métricas de tiempo de preparación después.

### 2.6 Dos empleados tocando el mismo pedido

En una pizzería a las nueve de la noche, dos personas van a abrir el mismo pedido. Si el `PATCH` de
estado no valida el estado de origen, el último clic gana y se pierde información.

**Recomendación:** el endpoint de cambio de estado recibe el estado esperado
(`{ from: "EN_PREPARACION", to: "LISTO" }`) y devuelve `409 Conflict` si no coincide, con el estado
actual en la respuesta para que la UI se refresque y explique qué pasó. Es más simple que un campo
`version` y da un error mucho más útil.

### 2.7 El agente va a duplicar pedidos si no hay idempotencia

Cuando n8n reintente un paso que falló por timeout —y va a pasar—, el mismo pedido se va a crear dos
veces. La cocina hace dos muzzarellas.

`POST /orders` debe aceptar un header `Idempotency-Key`, guardado con índice único por comercio: si
llega repetido, se devuelve el pedido ya creado en lugar de crear otro. Implementarlo ahora cuesta
poco; implementarlo después de haber servido dos pizzas de más cuesta credibilidad con el cliente.

### 2.8 ¿Dónde vive el carrito de la conversación?

La lista de herramientas del enunciado incluye `crear_pedido()` **y** `agregar_producto()`, lo que
implica que el pedido se va armando incrementalmente del lado del servidor. Hay dos caminos:

| Enfoque | Cómo funciona | Contras |
|---|---|---|
| Borrador persistido | El agente crea un pedido `DRAFT` y le va agregando items | Basura en la base de conversaciones abandonadas, riesgo de que un borrador aparezca en el panel |
| Cotización sin persistir | El agente arma el carrito en su contexto y llama a `POST /orders/quote` para que la API valide precios/disponibilidad y calcule totales; al confirmar, un único `POST /orders` | El agente debe mantener el estado de la conversación (que igual necesita mantener) |

**Recomendación: cotización sin persistir.** El panel operativo queda limpio, no hay que barrer
borradores, y el backend sigue siendo la única fuente de verdad de precios y totales — que es lo que
realmente importa. El endpoint `/orders/quote` también le sirve al panel web para calcular totales
en vivo mientras el operador carga un pedido, así que no es código exclusivo del agente.

**DECISIÓN PENDIENTE:** confirmar este enfoque antes de diseñar las herramientas de la fase 2.

### 2.9 Dos tipos de identidad, no uno

Un empleado y un proceso automático no se autentican igual:

- **Personas** (panel web): usuario + contraseña, access token corto en memoria, refresh token en
  cookie `httpOnly`.
- **Máquinas** (n8n, agente, futura app): **API key por comercio, con scopes**, almacenada hasheada
  y revocable.

El agente nunca debe usar las credenciales de un empleado: si lo hace, el historial de auditoría se
vuelve mentira ("Juan creó 400 pedidos a las 3 AM") y revocar el acceso del agente implica cambiarle
la contraseña a una persona. Además permite limitar al agente a lo que realmente necesita (leer
catálogo, crear pedidos) sin darle acceso a métricas o a la gestión de usuarios.

### 2.10 El costo de envío requiere una decisión de producto, no técnica

`calcular_envio()` puede significar tres cosas muy distintas: tarifa fija, tarifa por zona/barrio, o
tarifa por distancia real (que implica geocodificar direcciones, integrar una API de mapas, pagarla,
y tolerar que el cliente escriba mal la dirección por WhatsApp).

**Recomendación para el MVP:** zonas con precio fijo (`DeliveryZone`) más la posibilidad de que el
operador sobrescriba el costo a mano. Es como funciona hoy la mayoría de las pizzerías, no requiere
integración externa, y el agente puede preguntar el barrio en vez de pedir una dirección exacta
georreferenciable. La distancia real puede sumarse después sin cambiar el modelo del pedido, porque
el pedido ya guarda el costo como una foto.

### 2.11 "Los pedidos del día" no es obvio

Una pizzería cierra a la una de la mañana. Un pedido tomado a las 00:40 del sábado, ¿pertenece al
viernes o al sábado? Para la caja del negocio, casi siempre al viernes.

Propuesta: guardar todo en UTC, que cada comercio tenga su zona horaria, y definir un **día
operativo** con hora de corte configurable (por defecto las 05:00 locales). El dashboard y el listado
"de hoy" usan el día operativo, no la medianoche. Si esto no se define ahora, los números del
dashboard no van a coincidir con la caja y se pierde la confianza en el sistema.

### 2.12 El aislamiento multi-tenant no puede depender de que nadie se olvide

"Poner `commerce_id` en todas las tablas" es la parte fácil. La parte difícil es que **una sola
consulta sin filtrar** filtra los datos de un comercio a otro, y Prisma sobre MySQL no tiene
row-level security.

Propuesta concreta:

1. `commerce_id` en toda tabla de negocio, siempre en el índice compuesto principal.
2. Un `TenantContext` por request, derivado del token, nunca de un parámetro que mande el cliente.
3. Una extensión de Prisma Client (`$extends`) que inyecta automáticamente el filtro por comercio en
   los modelos marcados como tenant-scoped, para que olvidarse sea imposible por construcción.
4. Tests de aislamiento como parte del suite: crear dos comercios, verificar que ninguna ruta expone
   datos cruzados. Estos tests son requisito de la fase 1, no un extra.

### 2.13 WhatsApp Business API tiene tiempos que no dependen de nosotros

Aunque la integración sea fase 2, hay trámites que conviene arrancar ya porque tienen semanas de
latencia y una trampa importante:

- Requiere una cuenta de Meta Business verificada (documentación del comercio).
- **El número que se conecte a la API no puede seguir usándose en la app normal de WhatsApp.** Si la
  pizzería quiere usar su número de siempre, pierde el WhatsApp que usa hoy en el celular y el
  historial de chats. Esto ha frenado proyectos enteros al descubrirse tarde.
- Los mensajes iniciados por el negocio requieren plantillas aprobadas por Meta.
- El modelo de costos es por conversación, así que el volumen mensual afecta el precio.

Nada de esto es código, pero es camino crítico. Está en el cuestionario del documento 07.

### 2.14 Riesgos menores, anotados para no olvidarlos

- **Impresión de comanda.** No está en el enunciado, pero es lo primero que suele pedir una cocina al
  ver el sistema. No lo incluyo en el MVP; está en el cuestionario para dimensionarlo temprano.
- **Facturación fiscal.** Un pedido no es un comprobante. Si en algún momento hace falta facturar,
  se resuelve con un módulo aparte; el modelo actual no lo impide, pero tampoco lo contempla.
- **Tiempo real.** Coincido en no meter WebSockets en el MVP. Con polling cada 10–15 segundos alcanza
  de sobra para el volumen de una pizzería. Lo único que hay que hacer hoy es diseñar el listado con
  paginación por cursor y `updatedAt`, para que el polling sea barato y migrar a SSE después sea un
  cambio de transporte y no de contrato.
- **Migración de datos inicial.** El sistema arranca vacío. Cargar el menú a mano la primera vez es
  trabajo real; conviene un import por CSV o dejarlo agendado como tarea de puesta en marcha.

---

## 3. Decisiones que propongo tomar ya

| # | Decisión | Propuesta | Reversible |
|---|---|---|---|
| 1 | Estrategia multi-tenant | Base compartida + `commerce_id` + extensión de Prisma | Difícil |
| 2 | Representación del dinero | Enteros en centavos | Difícil |
| 3 | Catálogo | Producto → variantes (siempre ≥1) + modificadores en esquema | Difícil |
| 4 | Precios en el pedido | Snapshot completo por línea | Difícil |
| 5 | Estados | Enum + transiciones válidas + tabla de historial | Media |
| 6 | Identidad del cliente | Teléfono E.164 único por comercio | Media |
| 7 | Autenticación | JWT para personas, API keys con scopes para máquinas | Media |
| 8 | Concurrencia de estados | `from`/`to` explícito con `409` | Fácil |
| 9 | Idempotencia | `Idempotency-Key` en creación de pedidos | Fácil |
| 10 | Envíos | Zonas con precio fijo + override manual | Fácil |
| 11 | Día operativo | Zona horaria por comercio + corte a las 05:00 | Fácil |
| 12 | Tiempo real | Polling en fase 1, contrato preparado para SSE | Fácil |
| 13 | Carrito del agente | `/orders/quote` sin persistir | Media |

Las decisiones 1 a 4 son las que hay que discutir con más cuidado, porque cambiarlas después implica
migrar datos productivos.

---

## 4. Sobre el stack

El stack propuesto (React, TypeScript, Node, Express, MySQL, Prisma, Vite) es adecuado y no tengo
ninguna razón técnica de peso para cambiarlo. Conocerlo vale más que cualquier ganancia marginal de
otra opción. Los agregados que sí recomiendo, con el motivo:

| Elección | Por qué |
|---|---|
| Monorepo con workspaces (`apps/api`, `apps/web`, `packages/shared`) | Compartir los tipos y esquemas del contrato entre backend y frontend. Es la mayor ganancia de usar TypeScript en ambos lados |
| Zod para validación | Un solo esquema sirve para validar el request, inferir el tipo y generar el OpenAPI |
| OpenAPI generado desde el código | La documentación de la API no es un extra: es lo que va a leer el agente de IA para saber qué herramientas tiene |
| TanStack Query en el frontend | El estado de esta app es casi todo estado de servidor. Con Query no hace falta Redux ni nada parecido |
| Vitest + Supertest | Tests de integración sobre la API, incluidos los de aislamiento multi-tenant |
| Pino para logs estructurados | Con un `requestId` por request, indispensable cuando el que llame sea n8n y haya que rastrear qué pasó |

Sobre MySQL: funciona bien para esto. La única consideración es que si más adelante se quiere
row-level security nativa, PostgreSQL lo ofrece y MySQL no. No lo considero razón suficiente para
cambiar, dado que el aislamiento se resuelve en la capa de acceso a datos.

---

## 5. Qué sigue

Antes de escribir la primera línea de código de aplicación:

1. Confirmar las decisiones pendientes de la sección 3, sobre todo las cuatro primeras.
2. Llevar el cuestionario del documento [07](07-preguntas-para-la-pizzeria.md) a la pizzería. Hay
   respuestas —mitad y mitad, promociones, mesas— que cambian el esquema.
3. Aprobar el alcance del MVP del documento [06](06-mvp.md), en particular la lista de lo que queda
   afuera.
