# 8. Asistente conversacional de WhatsApp

El WhatsApp del negocio atiende solo: pasa la carta, cuenta las promos, arma el
pedido, cobra por adelantado cuando corresponde y avisa a una persona cuando no
puede resolverlo.

Este documento explica cómo está construido, por qué, y qué hace falta para
enchufarlo a un número real.

---

## 1. La decisión que ordena todo el diseño

> La arquitectura no puede quedar acoplada a n8n ni a un proveedor específico de
> IA. El backend/API es el núcleo del producto.

De ahí salen tres reglas que se cumplen en el código, no en la intención:

1. **El asistente no sabe nada del negocio.** Todo lo que puede hacer son
   llamadas a los mismos services que usa el panel. No conoce precios, no
   conoce el estado de un pedido y no puede saltearse el cobro previo, porque
   nunca toca esos datos directamente.
2. **El modelo de lenguaje es reemplazable.** Vive detrás de una interfaz de
   cuatro líneas (`LlmProvider`). Cambiar de proveedor es escribir otro archivo
   en `modules/agent/` y cambiar una variable de entorno.
3. **El canal es reemplazable.** WhatsApp entra por un adaptador que traduce el
   formato de Meta a "un teléfono escribió este texto". Sumar Instagram, un chat
   web o n8n es escribir otro adaptador; el asistente no se entera.

Consecuencia práctica: **el sistema funciona completo sin contratar nada**. El
proveedor por defecto es un asistente por reglas que no necesita credenciales ni
red.

---

## 2. Las piezas

```
WhatsApp (Meta)  ──►  whatsapp.webhook.ts  ─┐
n8n / otro canal ──►  POST /agent/messages ─┤
Simulador del panel ─────────────────────────┴──►  agent.service.ts
                                                      │
                                          ┌───────────┴───────────┐
                                          ▼                       ▼
                                    LlmProvider            agent.tools.ts
                              (scripted | anthropic |            │
                                     openai)                     ▼
                                                        services de pedidos,
                                                        catálogo, promociones…
```

| Archivo | Qué hace |
| --- | --- |
| `llm.provider.ts` | La interfaz. Nadie más conoce a los proveedores. |
| `llm.scripted.ts` | Asistente por reglas. Sin credenciales, determinista. |
| `llm.anthropic.ts` / `llm.openai.ts` | Traductores al formato de cada API. |
| `llm.factory.ts` | Elige el proveedor y le pone un respaldo. |
| `agent.tools.ts` | Lo que el asistente sabe hacer, sobre nuestros services. |
| `agent.service.ts` | El runtime: conversación, vuelta de herramientas, respuesta. |
| `agent.draft.ts` | El pedido a medio armar. |
| `agent.matching.ts` | "una muza grande" → una variante concreta del catálogo. |
| `whatsapp.webhook.ts` | El único archivo que conoce el formato de Meta. |

---

## 3. Las herramientas

El modelo no escribe SQL ni inventa datos: elige una de estas y con qué
argumentos llamarla.

| Herramienta | Para qué |
| --- | --- |
| `ver_menu` | Carta y precios actuales |
| `ver_promociones` | Promos vigentes hoy |
| `ver_zonas_de_envio` | A dónde se reparte, con costo y demora |
| `ver_medios_de_pago` | Medios habilitados y cuáles exigen pagar antes |
| `armar_pedido` | Agrega o corrige datos y devuelve total y qué falta |
| `vaciar_pedido` | El cliente se arrepintió |
| `confirmar_pedido` | Crea el pedido de verdad |
| `consultar_pedido` | Estado del último pedido de ese teléfono |
| `registrar_comprobante` | Guarda la captura para que alguien la verifique |
| `derivar_a_persona` | Deja de contestar y avisa al panel |

Todas devuelven, además del resultado, **qué falta** (`faltan`) para poder
confirmar. Ese campo es lo que hace que el asistente pregunte un dato por vez y
en el orden correcto, sin que haya que confiar en que el modelo lo recuerde.

### Qué no puede hacer

- **No puede cobrar de menos.** Los precios salen de la base en el momento de
  crear el pedido, no de lo que se le dijo al cliente ni de lo que el modelo
  crea recordar.
- **No puede confirmar un pago.** Puede registrar el comprobante; marcarlo como
  pago es una operación reservada a una persona (ver `docs/06`).
- **No puede prometer un envío que no existe.** Si el barrio no está entre las
  zonas de reparto, lo dice y ofrece las zonas reales. Nunca cobra envío $0 por
  no reconocer la dirección.
- **No puede cancelar un pedido.** Deriva a una persona.

---

## 4. El pedido a medio armar

Vive en la columna `draft` de la conversación, no en memoria. Tres razones:

- Una charla por WhatsApp se retoma tres horas después, y el "dale" del cliente
  tiene que saber a qué le está diciendo que sí.
- La respuesta puede venir contra otra instancia de la API.
- El personal puede ver en el panel qué está pidiendo alguien antes de que
  termine de decidirse.

Además, el estado del borrador viaja al modelo **aparte del historial**. El
historial que ve el modelo es sólo lo que vio el cliente: los resultados de
herramientas de mensajes viejos quedan afuera a propósito, porque son datos
vencidos —precios, estados, disponibilidad— y volver a mostrárselos lo llevaría
a repetirlos como si siguieran valiendo.

---

## 5. Cobro previo

Ya estaba resuelto en la API (ver `docs/06`); el asistente sólo lo transmite.

1. El pedido se crea con `paymentStatus = PENDING` si el medio exige prepago.
2. El asistente manda las instrucciones que **escribió el comercio** (alias,
   cuenta, QR). No las inventa.
3. El cliente manda la captura → `registrar_comprobante` →
   `paymentStatus = PROOF_SUBMITTED`.
4. Alguien del local la verifica contra la cuenta y confirma. Recién ahí el
   pedido puede avanzar a la cocina.

Una captura de pantalla se falsifica en minutos: sirve para que una persona
verifique, no para confirmar sola.

---

## 6. Derivación a una persona

Cuando el asistente deriva (reclamo, cancelación, algo que no entiende, o
agotó las vueltas sin poder responder):

- la conversación pasa a `HUMAN` y **el asistente deja de contestar**;
- aparece en el panel bajo "Necesitan a alguien", con el motivo;
- si alguien del local escribe a mano, la conversación pasa a `HUMAN` sola: el
  asistente y una persona hablándole al mismo cliente a la vez es peor que una
  respuesta tardía;
- un botón la devuelve al asistente cuando el tema se resolvió.

---

## 7. Probarlo sin WhatsApp

**Panel → Asistente → "Probar el asistente".** Se le escribe como si fuera un
cliente. Usa exactamente el mismo endpoint que WhatsApp (`POST /agent/messages`),
así que lo que se ve ahí es lo que va a pasar de verdad; la única diferencia es
que no encola ningún envío.

Una conversación que muestra todo el flujo:

```
Hola                          → se presenta y ofrece la carta
¿Qué promos tienen?           → lee las promociones vigentes hoy
Quiero 2 muzzarella grandes   → arma el pedido con precios de la base
Para envío                    → pide la dirección
Av. 18 de Julio 1580          → pide el barrio (sin barrio no hay costo de envío)
Centro                        → suma el envío al total
Transferencia                 → pide confirmación
Dale                          → crea el pedido y manda los datos para pagar
```

El pedido queda en el tablero, en la columna **Esperando pago**.

---

## 8. Conectarlo a un número real

Hace falta un número dado de alta en **WhatsApp Business Platform (Cloud API)**.
No sirve WhatsApp Business común: la app del celular no tiene API.

1. Crear una app en Meta for Developers y agregarle el producto WhatsApp.
2. Anotar el **Phone number ID** y guardarlo en el comercio
   (`Commerce.whatsappPhoneNumberId`). Es lo único que trae el webhook para
   saber a qué comercio pertenece un mensaje.
3. Configurar:
   ```
   WHATSAPP_PROVIDER=cloud
   WHATSAPP_PHONE_NUMBER_ID=...
   WHATSAPP_ACCESS_TOKEN=...
   WHATSAPP_VERIFY_TOKEN=<lo inventás vos>
   WHATSAPP_APP_SECRET=<lo da Meta>
   ```
4. En Meta, registrar el webhook apuntando a
   `https://TU-DOMINIO/webhooks/whatsapp` con el mismo `verify_token`, y
   suscribirse al campo `messages`.

**Sobre la firma:** cada entrega viene firmada con el secreto de la app. Sin
`WHATSAPP_APP_SECRET`, en producción la API rechaza todas las entregas: aceptar
mensajes sin verificar significaría que cualquiera que conozca la URL puede
meter pedidos falsos en la cocina.

### La ventana de 24 horas

WhatsApp sólo permite escribirle libremente a alguien dentro de las 24 horas
posteriores a su último mensaje. Fuera de esa ventana hace falta una plantilla
aprobada por Meta. El sistema lo sabe: los avisos que caen fuera de la ventana
quedan como `SKIPPED` con el motivo, en vez de fallar en silencio.

Como el asistente siempre responde a un mensaje del cliente, sus respuestas
están siempre dentro de la ventana. El caso que sí la toca son los avisos
automáticos (pedido listo, en camino) de un pedido tomado por teléfono el día
anterior.

---

## 9. Usar un modelo de lenguaje

```
LLM_PROVIDER=anthropic     # o "openai"
LLM_API_KEY=...
LLM_MODEL=...              # sin valor por defecto: lo elige quien despliega
```

Si el proveedor falla o se queda sin cuota, **el asistente por reglas responde
en su lugar** y queda registrado en el log. El negocio sigue tomando pedidos.

`LLM_BASE_URL` permite apuntar el proveedor "openai" a cualquier servicio
compatible, incluido un modelo corriendo en una máquina propia. Es la salida si
el costo por conversación se vuelve un problema.

### Por qué el asistente por reglas no es una maqueta

Entiende bastante menos que un modelo y no lo disimula: ante la duda deriva a
una persona. Pero cumple tres funciones que ningún modelo puede cumplir:

- permite probar y **mostrar** el producto completo sin contratar nada;
- hace testeable el runtime de punta a punta y de forma determinista;
- es el piso de servicio cuando el proveedor de IA se cae.

---

## 10. Lo que falta

| Pendiente | Por qué no está |
| --- | --- |
| Descargar la imagen del comprobante desde Meta | Requiere credenciales reales; hoy se guarda la referencia (`whatsappMediaId`) |
| Plantillas aprobadas por Meta | Las aprueba Meta sobre una cuenta real |
| Confirmación de pago por API de Mercado Pago | Es la única forma de confirmar un pago sin que alguien mire; recomendado como próximo paso |
| Pizza mitad y mitad | Bloqueado por el bloque A de `docs/07` |
| Audios | Requiere transcripción; se deriva a una persona |
