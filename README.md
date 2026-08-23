# AutoElite — Plataforma de gestión de pedidos para gastronomía

Plataforma de gestión de pedidos para comercios gastronómicos, con un piloto inicial en una
pizzería y un agente de IA sobre WhatsApp en fases posteriores.

**Estado actual: MVP funcional, con el asistente de WhatsApp construido.** El sistema permite operar
una pizzería de punta a punta —cargar pedidos, seguirlos por estado, gestionar menú y clientes, ver
métricas— y su número de WhatsApp atiende solo: pasa la carta, arma pedidos y cobra por adelantado.

Viene cargado con los datos del comercio piloto, **Pizzería Nuevo Quijote** (Brazo Oriental,
Montevideo), para poder mostrarlo funcionando. Qué es real y qué hay que completar antes de
presentárselo está en [docs/09](docs/09-nuevo-quijote.md).

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
| [08 — Asistente de WhatsApp](docs/08-asistente-whatsapp.md) | Cómo funciona el asistente, qué puede y qué no puede hacer, y cómo enchufarlo a un número real |
| [09 — Puesta en marcha para Nuevo Quijote](docs/09-nuevo-quijote.md) | Qué datos del negocio son reales, cuáles son propuesta nuestra y qué hay que pedirles |

## Funcionalidad

| Módulo | Qué hace |
|---|---|
| **Tablero de pedidos** | Columnas por estado, con antigüedad de cada pedido y avance en un toque |
| **Alta de pedido** | Todo en una vista: reconoce al cliente por teléfono, arma el pedido y muestra el total calculado por el backend |
| **Menú** | Productos con tamaños y extras; corte de disponibilidad durante el servicio |
| **Clientes** | Ficha con direcciones, cantidad de pedidos y total gastado, alimentada sola |
| **Historial** | Filtros por estado, modalidad y texto |
| **Dashboard** | Ventas, cantidad de pedidos, ticket promedio, más vendidos y distribución por modalidad y pago |
| **Configuración** | Comercio, zonas de envío, métodos de pago, promociones y usuarios |
| **Avisos por WhatsApp** | Mensajes automáticos al cliente cuando el pedido se confirma, está listo para retirar o sale a la calle |
| **Asistente de WhatsApp** | Atiende solo: pasa la carta, cuenta las promos, arma el pedido, cobra por adelantado y deriva a una persona cuando hace falta |

### Avisos automáticos al cliente

Cuando el personal mueve un pedido de estado, el sistema le avisa al cliente por WhatsApp:

| Estado | Qué recibe el cliente |
|---|---|
| Pedido recibido | Sólo si llegó por WhatsApp o por la web: quien pidió por teléfono ya lo sabe |
| Confirmado | "Confirmamos tu pedido #37 y ya lo estamos preparando" |
| Listo | Sólo en retiro y salón. En un envío el pedido todavía no salió, y avisar ahí haría salir al cliente a la puerta al pedo |
| En camino | "Tu pedido #37 salió a Av. Millán 3920" |
| Cancelado | Con el motivo |

Los mensajes van a una cola persistida en vez de enviarse en medio del request: marcar un pedido como
listo no puede quedar esperando a la API de WhatsApp, y una caída del proveedor no puede perder
avisos. Se reintentan solos, y el panel muestra en el detalle del pedido qué se le dijo al cliente y
si llegó.

**Sin credenciales de Meta, los envíos se simulan** y quedan en el log: alcanza para probar el flujo
completo. Para enviar de verdad hay que poner `WHATSAPP_PROVIDER=cloud` y completar las credenciales
de WhatsApp Business Cloud API.

Una limitación que impone WhatsApp, no el sistema: sólo se puede escribir libremente a alguien dentro
de las **24 horas** posteriores a su último mensaje. Fuera de esa ventana hace falta una plantilla
aprobada por Meta. El aviso queda marcado como "no enviado" con el motivo a la vista, para que el
personal sepa que a ese cliente hay que llamarlo.

### El asistente que atiende el WhatsApp

El número del negocio contesta solo. Pasa la carta con precios reales, cuenta las promociones
vigentes, arma el pedido, pide la dirección y el barrio, cobra por adelantado cuando el medio lo
exige, y recibe la captura del comprobante para que alguien la verifique.

Lo que **no** puede hacer, por construcción y no por buena voluntad del modelo:

- inventar un precio, una promoción o una demora: todo sale de la base en el momento;
- confirmar un pago: registra el comprobante, pero marcarlo como pago es de una persona;
- prometer un envío a un barrio al que no se reparte, ni cobrar envío $0 por no reconocer la
  dirección;
- cancelar un pedido: eso lo mira alguien del local.

Ante un reclamo, un pedido de cancelación o cualquier cosa que no pueda resolver, **deriva a una
persona y deja de contestar**. La conversación aparece en el panel bajo "Necesitan a alguien", con el
motivo, y un botón la devuelve al asistente cuando el tema se resolvió.

**Se puede probar sin WhatsApp.** En **Asistente → Probar el asistente** se le escribe como si fueras
un cliente; usa el mismo endpoint que WhatsApp, así que lo que se ve ahí es lo que va a pasar de
verdad. Y **no necesita ninguna cuenta de IA**: el proveedor por defecto es un asistente por reglas
que funciona sin credenciales. Para usar un modelo de lenguaje alcanza con `LLM_PROVIDER=anthropic`
(u `openai`) más la clave y el modelo; si ese proveedor se cae, el de reglas responde en su lugar y
el negocio sigue tomando pedidos.

Los detalles —herramientas disponibles, cómo conectar un número real, la ventana de 24 horas— están
en [docs/08](docs/08-asistente-whatsapp.md).

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
usuario y la contraseña de acceso más la lista de datos que faltan completar. Se puede volver a
correr cuando se quiera: limpia y recarga sólo los datos operativos del comercio piloto.

### Si algo falla

**`bind: address already in use` en el puerto 3306** — ya hay un MySQL corriendo en tu máquina. No
hace falta apagarlo: cambiá en el `.env` el puerto por el que se publica el contenedor.

```bash
MYSQL_PORT=3307
DATABASE_URL="mysql://root:root@localhost:3307/autoelite"
```

Después `docker compose down && pnpm db:up`. Para ver qué lo está ocupando:
`lsof -nP -i:3306 | grep LISTEN`.

**`Can't reach database server`** — el contenedor todavía está arrancando. MySQL tarda unos segundos
la primera vez; reintentá `pnpm db:setup`.

**El panel carga pero no hay datos** — falta correr `pnpm db:setup`, o la API no está levantada en
otra terminal.

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

## Datos cargados

El sistema viene con los datos de **Pizzería Nuevo Quijote** (Brazo Oriental, Montevideo), el
comercio piloto. Del negocio se tomó lo verificable —nombre, barrio, rubro de la carta y que
atiende todos los días desde las 19:00—; los precios, las zonas de reparto y las promociones son
una propuesta de arranque que se corrige desde el panel, y los clientes e historial son ficticios
para que el tablero tenga algo que mostrar.

**Los datos de cobro están vacíos a propósito.** Un alias de transferencia equivocado manda la
plata del cliente a otra cuenta, así que el asistente avisa que faltan cargar en vez de inventar
un número.

Qué es real, qué es propuesta y qué hay que pedirle al comercio está en
[docs/09](docs/09-nuevo-quijote.md), junto con el guion de los cinco minutos antes de la reunión.

Hay una decisión de modelo que quedó abierta a propósito y conviene cerrar antes de cargar datos
reales: **la pizza mitad y mitad**. Está en el bloque A de
[docs/07](docs/07-preguntas-para-la-pizzeria.md), junto con el resto de lo que hay que validar con el
comercio.
