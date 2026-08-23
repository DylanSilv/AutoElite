# 05 — Estructura del frontend

## 1. Contexto de uso

Esto no es un sitio que se navega con calma: es una herramienta que alguien usa parado, con las manos
ocupadas, mientras suena el teléfono y hay quince pedidos en cocina. Eso manda sobre el diseño más
que cualquier preferencia estética:

- **Objetivos grandes.** El personal va a tocar la pantalla apurado, muchas veces desde una tablet.
- **Cargar un pedido tiene que ser rápido.** Es la acción que se repite cien veces por noche; si
  requiere seis clics y tres pantallas, van a seguir usando el papel.
- **La pantalla operativa se mira de lejos.** El estado de un pedido tiene que leerse a dos metros.
- **Nada de confirmaciones innecesarias**, salvo en lo destructivo (cancelar un pedido).

## 2. Stack

| Elección | Motivo |
|---|---|
| React + TypeScript + Vite | Stack conocido, arranque rápido |
| TanStack Query | Casi todo el estado es estado de servidor: cache, revalidación y polling salen gratis. No hace falta Redux |
| React Router | Ruteo estándar |
| React Hook Form + Zod | Los mismos esquemas de `packages/shared` que valida el backend |
| Tailwind CSS + shadcn/ui | Componentes accesibles y consistentes sin construir un sistema de diseño desde cero |
| Recharts | Los cuatro gráficos del dashboard, sin más |

Estado de UI (modal abierto, filtro seleccionado) con `useState` y contexto. Nada de librería de
estado global: en esta aplicación no hay estado global de cliente que lo justifique.

## 3. Estructura

Organización por features, no por tipo de archivo. Cuando haya que tocar "pedidos", todo lo de
pedidos está en una carpeta.

```
apps/web/src/
├── app/
│   ├── router.tsx           Rutas y protección por rol
│   ├── providers.tsx        QueryClient, auth, toasts
│   └── layout/              Shell, navegación, encabezado
├── features/
│   ├── auth/
│   ├── orders/
│   │   ├── api/             Hooks de TanStack Query
│   │   ├── components/      OrderBoard, OrderCard, OrderDetail, OrderForm, StatusBadge
│   │   ├── hooks/
│   │   └── pages/           OrdersBoardPage, NewOrderPage, OrderDetailPage, OrderHistoryPage
│   ├── products/
│   ├── categories/
│   ├── customers/
│   ├── dashboard/
│   └── settings/
├── components/ui/           Componentes base compartidos
├── lib/
│   ├── api-client.ts        Fetch tipado, refresh automático, mapeo de errores
│   ├── money.ts             Centavos → "$12.500"
│   ├── date.ts              UTC → hora local del comercio
│   └── query-keys.ts
└── types/                   Reexporta desde packages/shared
```

## 4. Pantallas del MVP

### 4.1 Panel de pedidos (pantalla principal)

Tablero por columnas de estado: **Pendientes · En preparación · Listos · En camino · Entregados**.
Es la pantalla que va a estar abierta todo el servicio.

Cada tarjeta muestra lo mínimo para decidir sin abrirla: número, hora, nombre del cliente, tipo de
pedido con un ícono distinguible, total y un indicador de tiempo transcurrido. Un pedido pendiente
hace 20 minutos tiene que verse distinto de uno que entró recién — eso solo es información visual,
pero es lo que evita que un pedido se pierda.

Avanzar el estado se hace con un botón directo en la tarjeta ("Marcar listo"), no entrando al
detalle. El detalle se abre en un panel lateral para ver items y observaciones sin perder el tablero.

Actualización por polling cada 10–15 segundos con TanStack Query (`refetchInterval`), pausado cuando
la pestaña no está visible. Cuando llegue el momento de SSE, se cambia el transporte y los
componentes no se enteran.

Las columnas se adaptan al tipo de pedido: "En camino" solo tiene sentido con delivery, así que si
el comercio no hace envíos esa columna no se muestra.

### 4.2 Nuevo pedido

La pantalla más crítica del MVP. Flujo en una sola vista, sin asistente por pasos:

1. **Cliente:** buscador por teléfono que resuelve mientras se tipea. Si existe, trae nombre y
   direcciones; si no, se crea en línea sin cambiar de pantalla.
2. **Tipo de pedido:** tres botones grandes. Elegir "Envío" revela dirección y zona; el resto de los
   tipos no muestra campos que no corresponden.
3. **Productos:** catálogo por categoría con búsqueda, y selección de variante en el momento de
   agregar. Cada línea permite cantidad, extras y una nota.
4. **Resumen:** subtotal, envío, descuento y total, **calculados por `POST /orders/quote`** con
   debounce, no en el navegador. El número que ve el operador es el que va a guardar el backend.
5. **Pago y observaciones**, y confirmar.

El foco arranca en el buscador de cliente y todo el flujo debe poder recorrerse con teclado, porque
quien atiende el teléfono tipea más rápido de lo que toca.

### 4.3 Detalle de pedido

Todos los datos, líneas con sus extras, totales desglosados, historial de estados con autor y hora, y
las acciones disponibles según el estado actual. Editar solo se permite mientras el estado lo
autoriza; después, la única salida es cancelar con motivo.

### 4.4 Historial

Listado con filtros por rango de fechas, estado, tipo, método de pago, origen y cliente. Scroll
infinito sobre la paginación por cursor. Exportar a CSV es útil y barato, pero queda fuera del MVP
salvo que la pizzería lo pida.

### 4.5 Productos y categorías

ABM con orden por arrastre, variantes con precio y un interruptor de disponibilidad accesible desde
el listado. Ese interruptor importa más de lo que parece: "se acabó la muzzarella" es algo que pasa a
las diez de la noche y tiene que resolverse en un toque desde el celular.

### 4.6 Clientes

Listado con buscador por nombre o teléfono, ficha con direcciones, historial, cantidad de pedidos y
total gastado.

### 4.7 Dashboard

Cuatro tarjetas de resumen (ventas del día, cantidad de pedidos, ticket promedio, pedidos activos) y
cuatro gráficos: ventas por período, productos más vendidos, distribución por modalidad y por método
de pago. Nada más. Un dashboard con veinte métricas que nadie mira es peor que uno con ocho que se
usan todos los días.

### 4.8 Configuración

Datos del comercio, zona horaria y corte del día operativo, métodos de pago, zonas de envío y
usuarios.

## 5. Convenciones

- **Todo el acceso a la API pasa por hooks de TanStack Query** en `features/*/api`. Ningún componente
  llama a `fetch` directamente.
- **Cache invalidada por clave**: crear un pedido invalida `['orders']` y `['dashboard']`.
- **Actualizaciones optimistas solo en el cambio de estado**, que es donde la latencia se nota. Ante
  un `409` se revierte y se muestra qué pasó ("otro usuario ya marcó este pedido como listo").
- **Los errores del backend se muestran por su `code`**, traducido a un mensaje en español; nunca se
  muestra el error crudo.
- **El dinero se formatea en un solo lugar** (`lib/money.ts`). Ningún componente divide por 100 por
  su cuenta.
- **Rutas protegidas por rol**, con la misma matriz de permisos que aplica el backend. El control del
  frontend es comodidad; la autorización real siempre es del servidor.

## 6. Responsive

Prioridad: tablet horizontal (el uso real en el mostrador), después escritorio, después celular. En
celular, el tablero de pedidos pasa de columnas a una lista con filtro por estado, y "nuevo pedido"
sigue siendo usable con una sola mano.

## 7. Fuera del alcance del frontend en la fase 1

- Tiempo real con WebSockets o SSE.
- Impresión de comandas.
- Modo oscuro.
- Internacionalización: solo español.
- Cualquier pantalla relacionada con el agente o WhatsApp.
