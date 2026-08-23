# 07 — Qué validar con la pizzería antes de desarrollar

Cuestionario para llevar al comercio. Está ordenado por **cuánto cuesta equivocarse**: las primeras
preguntas cambian el esquema de la base de datos, las últimas solo cambian una pantalla.

Conviene además **pasar una noche de servicio mirando cómo trabajan**. Media hora de observación
suele valer más que este cuestionario entero, porque la gente describe el proceso que cree que tiene,
no el que realmente ejecuta.

---

## Bloque A — Bloquean el modelo de datos (etapa 1.3)

Sin estas respuestas no se puede cerrar el esquema del catálogo.

### A1. Mitad y mitad

**¿Venden pizzas mitad de un gusto y mitad de otro?** Si la respuesta es sí:

- ¿Cómo se cobra: el precio del más caro, el promedio, un recargo fijo?
- ¿Se permite en todos los tamaños?
- ¿Puede haber tres gustos?

> Por qué importa: cambia la estructura de la línea de pedido. Es el único punto del modelo que
> preferí dejar abierto en el documento 03 hasta tener la respuesta.

### A2. Tamaños

- ¿Qué tamaños manejan exactamente y con qué nombres los llaman? (chica/mediana/grande, o porciones)
- ¿**Todos** los productos tienen los mismos tamaños, o hay productos con uno solo?
- ¿Hay productos donde el tamaño no sea un tamaño sino otra cosa (por porción, por docena)?

### A3. Extras y adicionales

- ¿Qué extras ofrecen y a qué precio?
- ¿El precio del extra es el mismo en una pizza chica que en una grande?
- ¿Hay límite de extras por pizza?
- ¿Registran pedidos "sin" algo (sin cebolla, sin sal)? ¿Afecta el precio?

### A4. Promociones y combos

- ¿Tienen promos vigentes? (2x1 los martes, combo pizza + bebida, descuento por retiro)
- ¿Cómo se cobra exactamente cada una?
- ¿Hacen descuentos a mano, caso por caso?

> Las promociones quedan fuera del MVP, pero necesito saber si existen para que el modelo de
> descuentos no las haga imposibles después.

### A5. Salón

- ¿Tienen mesas? ¿Necesitan registrar el número de mesa en el pedido?
- ¿Un pedido de salón puede ampliarse después de haber empezado a prepararse?

---

## Bloque B — Definen el flujo operativo (etapa 1.5 y 1.6)

### B1. El recorrido real de un pedido

Pedirles que cuenten, paso a paso, qué pasa desde que suena el teléfono hasta que el cliente come.
Puntualmente:

- ¿Quién toma el pedido y en qué lo anota?
- ¿Cómo se entera la cocina?
- ¿Cómo sabe el mostrador que un pedido está listo?
- ¿Los siete estados propuestos coinciden con la realidad, sobran o faltan?
- ¿Alguien "confirma" un pedido, o entra directo a preparación?

### B2. Volumen

- ¿Cuántos pedidos tienen un viernes o sábado a la noche?
- ¿Cuál es el pico y en qué franja horaria?
- ¿Cuántas personas usarían el sistema al mismo tiempo?

> Define si hace falta tiempo real y cuánto hay que optimizar la pantalla de carga.

### B3. Roles

- ¿Todos hacen de todo o hay puestos definidos (caja, cocina, reparto)?
- ¿Hay algo que solo el dueño deba poder ver o hacer? (precios, métricas, cancelaciones)

### B4. Envíos

- ¿El costo de envío es fijo, por zona/barrio, o por distancia?
- Si es por zona: **¿cuáles son las zonas y cuánto cuesta cada una?**
- ¿Hay un radio máximo de reparto?
- ¿Envío gratis a partir de cierto monto?
- ¿Tienen cadetes propios o usan una app de terceros?
- ¿Necesitan saber qué cadete lleva cada pedido?

### B5. Cobros

- ¿Con qué medios cobran? (efectivo, transferencia, débito, crédito, Mercado Pago)
- ¿Necesitan registrar con cuánto paga el cliente para calcular el vuelto?
- ¿Registran si un pedido ya está pagado o se paga contra entrega?
- ¿Cobran seña en pedidos grandes?
- ¿Hacen cierre de caja? ¿Con qué números?

### B6. Horarios y el "día"

- ¿Qué días y en qué horario abren?
- ¿Hasta qué hora cierran? **Un pedido de las 00:40 del sábado, ¿es del viernes o del sábado para la
  caja?**
- ¿Toman pedidos programados ("mandámela a las 21")?

> Define la hora de corte del día operativo. Si no coincide con cómo cuentan ellos, el dashboard no
> va a coincidir con la caja y van a dejar de confiar en el sistema.

### B7. Impresión

- ¿Necesitan imprimir la comanda para la cocina?
- ¿Tienen impresora térmica? ¿Qué marca y modelo? ¿Está conectada a una PC o en red?
- ¿O prefieren una pantalla en cocina?

> No está en el MVP, pero es el pedido más probable apenas vean el sistema, y el hardware condiciona
> la solución.

### B8. Cancelaciones y errores

- ¿Con qué frecuencia se cancela un pedido y por qué?
- ¿Qué pasa cuando se equivocan de pedido? ¿Se rehace, se descuenta?
- ¿Quién puede cancelar?

---

## Bloque C — Preparan la fase 2 (empezar el trámite ya)

### C1. El número de WhatsApp — decisión crítica

**Conectar un número a la API de WhatsApp Business implica que ese número deja de funcionar en la app
normal de WhatsApp, y se pierde el historial de chats.**

- ¿Qué número usan hoy para recibir pedidos? ¿Es un número personal de alguien?
- ¿Están dispuestos a usar un número nuevo para el agente, o quieren migrar el actual?
- Si quieren migrar el actual: ¿entienden que pierden el WhatsApp del celular en ese número?
- ¿Tienen cuenta de Meta Business? ¿La empresa está verificada?

> Es la conversación más importante del bloque C, y conviene tenerla temprano: el trámite lleva
> semanas y esta decisión no se puede deshacer fácilmente.

### C2. Volumen de conversaciones

- ¿Cuántas conversaciones de WhatsApp reciben por día?
- ¿Qué proporción son pedidos y qué proporción son consultas ("¿están abiertos?", "¿cuánto sale la
  grande?")?
- ¿Cuántos mensajes de audio reciben?

> La API de WhatsApp se cobra por conversación: el volumen define el costo operativo mensual, y hay
> que saberlo antes de prometer nada.

### C3. Expectativas sobre el agente

- ¿Qué tan cómodos están con que un bot atienda sin que nadie mire?
- ¿En qué situaciones quieren que derive a una persona sí o sí? (reclamos, pedidos grandes, algo
  fuera del menú)
- ¿Quieren revisar las respuestas del agente antes de que se envíen, al menos al principio?
- ¿Hay un tono o forma de hablar propia del negocio que el agente deba respetar?

### C4. Preguntas frecuentes reales

Pedirles **capturas de conversaciones reales de WhatsApp** (con los datos personales tapados). Es el
insumo más valioso que existe para diseñar el agente: muestra cómo pide la gente de verdad, con qué
modismos, cuántas idas y vueltas hacen falta, y dónde se traba la conversación. Vale más que
cualquier especificación escrita.

---

## Bloque D — Datos iniciales y puesta en marcha

### D1. Migración

- ¿Tienen el menú en digital (Excel, Word, la carta del diseñador)?
- ¿Tienen una lista de clientes con teléfonos y direcciones?
- ¿En qué formato?

> Si hay una lista de clientes, importarla al arranque hace que el sistema sea útil desde el primer
> día en vez de arrancar vacío.

### D2. Equipamiento

- ¿Con qué dispositivos cuentan? (PC en el mostrador, tablet, celulares)
- ¿Cómo es la conexión a internet? ¿Se cae seguido?
- ¿Qué pasa si se cae internet en pleno servicio?

> La última pregunta puede obligar a pensar en algún grado de operación degradada. No está en el MVP,
> pero conviene saber el riesgo.

### D3. Adopción

- ¿Quién en el local va a ser el referente del sistema?
- ¿Hay alguien con resistencia al cambio? ¿Qué edad y qué comodidad tecnológica tiene el equipo?
- ¿Cuándo pueden hacer la noche de prueba en paralelo con el papel?

---

## Cómo usar las respuestas

| Bloque | Bloquea |
|---|---|
| A | Etapa 1.3 (catálogo). Sin esto no se cierra el esquema |
| B | Etapas 1.5 y 1.6 (pedidos y panel) |
| C | Fase 2, pero el trámite de C1 debe arrancar durante la fase 1 |
| D | Puesta en marcha del piloto |

Cuando estén las respuestas del bloque A, actualizo el documento 03 y arrancamos con la
implementación.
