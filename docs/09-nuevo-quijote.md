# 9. Puesta en marcha para Pizzería Nuevo Quijote

El sistema viene cargado con los datos de **Pizzería Nuevo Quijote** (Brazo Oriental,
Montevideo) para poder mostrárselo al negocio funcionando, no como una maqueta genérica.

Este documento separa tres cosas que conviene no mezclar: **lo que es real**, **lo que es una
propuesta nuestra** y **lo que hay que pedirle al comercio antes de la reunión**.

---

## 1. Lo que está confirmado

| Dato | Valor | De dónde salió |
| --- | --- | --- |
| Nombre | Pizzería Nuevo Quijote | Perfil público del negocio |
| Barrio | Brazo Oriental, sobre Av. Burgues | Perfil público y ubicación en el mapa |
| Rubro de la carta | Pizzas, fainá, lehmeyún y sándwiches calientes | Perfil público |
| Horario | Todos los días desde las 19:00 | Perfil público |

Eso es todo lo que se pudo verificar sin hablar con ellos. El resto está construido encima.

---

## 2. Lo que es una propuesta nuestra

Está cargado para que la demostración se vea completa, pero **no son sus datos**. Todo se
corrige desde el panel, sin tocar código.

### Precios

Los precios de la carta son estimaciones de plaza para una pizzería de barrio en Montevideo.
Van a estar cerca, pero no van a ser exactos.

> **Se corrigen en:** panel → **Menú** → cada producto.

Es lo primero que va a mirar el dueño, y es lo que más rápido rompe la ilusión si está mal.
Conviene sentarse con la carta del local al lado y ajustar los quince o veinte productos antes
de mostrarlo.

### Zonas de reparto

Los barrios son los que rodean al local sobre el eje de Av. Burgues, ordenados por distancia:

Brazo Oriental · Aires Puros · Atahualpa · Prado · Reducto · Cerrito de la Victoria · Sayago ·
Capurro

Las tarifas ($100 a $170) son una progresión razonable, no las suyas. Y sobre todo: **no sabemos
hasta dónde reparten de verdad**. Puede que no lleguen a Capurro, o que lleguen a barrios que no
están en la lista.

> **Se corrigen en:** panel → **Configuración** → Zonas de envío.

Un barrio que no está en la lista no recibe envío: el asistente lo dice y ofrece las zonas
reales, en vez de prometer algo que el local no puede cumplir.

### Promociones

Las tres cargadas (martes de muzza 2x1, Combo Quijote, envío sin costo en el barrio) son
ejemplos para mostrar cómo funciona la sección. Las reales las dicta el negocio.

> **Se corrigen en:** panel → **Configuración** → Promociones. Se encienden y apagan con un
> botón, y el asistente deja de mencionarlas en el mismo momento.

### Clientes e historial

Los 8 clientes y los ~190 pedidos de las últimas dos semanas son **inventados**. Existen para
que el tablero y el dashboard tengan algo que mostrar. Los teléfonos no corresponden a nadie.

Cuando el negocio se sume, se borran y se cargan los suyos.

---

## 3. Lo que está deliberadamente vacío

**Los datos de cobro.** El alias de transferencia y el QR de Mercado Pago están en blanco a
propósito, y el asistente le contesta al cliente:

> ⚠️ Faltan cargar los datos de cobro en el panel (Configuración → Métodos de pago).

Se ve feo, y esa es exactamente la intención. Un alias equivocado no es un detalle cosmético:
manda la plata de un cliente a la cuenta de otra persona. Es mejor que el error salte en el
primer pedido de prueba a que se convierta en una transferencia perdida.

**El teléfono del local** figura como `+598 2 000 0000`, un marcador evidente.

**La altura exacta sobre Av. Burgues** no la pudimos confirmar; la dirección dice sólo la
avenida y el barrio.

---

## 4. Qué pedirle al negocio

Ordenado por lo que más traba si falta.

### Antes de mostrarles el sistema

1. **La carta con precios actuales.** Una foto del cartel o del menú de reparto alcanza.
2. **Hasta dónde reparten** y cuánto cobran por zona.
3. **El teléfono** del local y la dirección exacta.

### Antes de tomar el primer pedido real

4. **Alias o cuenta para transferencias**, con titular. Sin esto el cobro previo no funciona.
5. **El QR o el alias de Mercado Pago.**
6. **Quién verifica los pagos** y desde qué dispositivo. Es una persona mirando la cuenta del
   banco; hay que saber quién y en qué momento del servicio.

### Para conectar el WhatsApp

7. **Un número dedicado**, dado de alta en WhatsApp Business Platform. No sirve el WhatsApp
   Business común del celular: la app no tiene API. Si hoy usan ese número para atender a mano,
   hay que decidir si lo migran o consiguen uno nuevo.
8. **Quién queda a cargo** de las conversaciones que el asistente deriva.

### Decisiones de producto que todavía no tomamos

9. **Pizza mitad y mitad.** Si la venden, hay que definir cómo se cobra antes de cargar el menú
   real: cambia la estructura de la línea de pedido. Está en el bloque A de
   [docs/07](07-preguntas-para-la-pizzeria.md).
10. **Media docena de lehmeyún:** ¿se puede combinar sabores? Hoy cada sabor es un producto
    aparte, así que "media docena mitad carne mitad verdura" no se puede pedir.
11. **Mínimo de compra** para envío, si tienen.

---

## 5. Los cinco minutos antes de la reunión

```bash
pnpm db:up        # levanta la base
pnpm db:setup     # migra y carga los datos de Nuevo Quijote
pnpm dev          # levanta la API y el panel
```

Abrí **http://localhost:5173** — ese es el panel. El 3000 es la API y no tiene pantallas.

Entrás con **admin@nuevoquijote.local** / **demo-quijote-2026**.

El seed imprime al final la lista de lo que falta completar, para que no se pase por alto.

**Qué mostrar, en este orden:**

1. **Pedidos** — el tablero con el servicio en curso. Se entiende sin explicar nada.
2. **Asistente → Probar el asistente** — escribirle como si fueras un cliente. Esto es lo que
   vende: no necesita ni WhatsApp conectado ni cuenta de IA.
   - "¿a qué hora abren?"
   - "me pasás la carta?"
   - "quiero 2 lehmeyún y una muzza grande" → "para envío" → "Av. Millán 3920" → "Prado" →
     "transferencia" → "dale"
3. **Pedidos** de nuevo — el pedido nuevo aparece en la columna **Esperando pago**, que es el
   argumento más fuerte: nadie cocina hasta que la plata está.
4. **Dashboard** — lo que el dueño no tiene hoy: ventas, ticket promedio, qué se vende más.

Lo que conviene decir en voz alta mientras se muestra: **los precios y las zonas son de
ejemplo**, y se cargan los suyos en un rato. Es preferible aclararlo antes de que lo noten.
