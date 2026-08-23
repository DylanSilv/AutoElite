import { normalize, parseRequestedItems } from './agent.matching.js';
import type { LlmCompletion, LlmProvider, LlmRequest } from './llm.provider.js';

/**
 * Asistente por reglas.
 *
 * Ocupa el lugar del modelo de lenguaje: recibe la conversación y decide qué
 * herramienta llamar y cómo redactar la respuesta. Existe por tres razones
 * concretas, no como maqueta:
 *
 * 1. El flujo completo —carta, promos, armado del pedido, cobro previo,
 *    comprobante, derivación a una persona— se puede probar y mostrar sin
 *    contratar ningún proveedor de IA ni gastar conversaciones de WhatsApp.
 * 2. Hace testeable el runtime del agente de punta a punta y de forma
 *    determinista, que con un modelo real no se puede.
 * 3. Es el piso de servicio: si el proveedor de IA se cae o se queda sin cuota,
 *    el negocio sigue tomando pedidos en vez de dejar de contestar.
 *
 * Entiende bastante menos que un modelo, y no lo disimula: ante la duda deriva
 * a una persona en vez de improvisar.
 */

/** Marca que el runtime agrega cuando el mensaje traía una imagen. */
export const IMAGE_MARKER = '[imagen adjunta]';

const YES = /\b(si|sii+|sisi|dale|ok|oka|okey|listo|confirmo|confirma|va|vale|perfecto|de una|correcto|exacto|bien)\b/;
const NO = /\b(no|nop|todavia|espera|pera|cambio|cambiar)\b/;

interface ToolEcho {
  name: string;
  result: Record<string, unknown>;
}

function toolCall(name: string, args: Record<string, unknown> = {}): LlmCompletion {
  return { text: null, toolCalls: [{ id: `${name}-${Date.now()}`, name, arguments: args }] };
}

function say(text: string): LlmCompletion {
  return { text, toolCalls: [] };
}

// ---------------------------------------------------------------------------
// Interpretación de lo que escribe el cliente
// ---------------------------------------------------------------------------

/**
 * Dirección escrita a mano.
 *
 * Es una heurística deliberadamente simple: calle + último número, y lo que
 * venga después de una coma como referencia. Lo que no reconoce queda igual en
 * la referencia, así el cadete lo lee entero aunque el parseo falle.
 */
function parseAddress(text: string): Record<string, string> | null {
  const clean = text.trim();
  if (clean.length < 4) return null;

  const [first, ...rest] = clean.split(',');
  const head = (first ?? '').trim();
  const tail = rest.join(', ').trim();

  const numberMatch = head.match(/(\d{1,5})\s*$/) ?? head.match(/\b(\d{2,5})\b/);
  const numero = numberMatch?.[1];
  const calle = numero ? head.replace(numero, '').replace(/\s+/g, ' ').trim() : head;

  if (calle.length < 3) return null;

  const aptoMatch = clean.match(/\b(?:apto|apartamento|apart|piso|depto)\.?\s*([\w-]+)/i);

  return {
    calle,
    ...(numero ? { numero } : {}),
    ...(aptoMatch?.[1] ? { apartamento: aptoMatch[1] } : {}),
    ...(tail ? { referencia: tail } : {}),
  };
}

const INTENTS: { name: string; pattern: RegExp }[] = [
  { name: 'menu', pattern: /\b(carta|menu|precios?|que tienen|que hay|tenes pizza|cuanto (sale|cuesta|vale))\b/ },
  { name: 'promos', pattern: /\b(promo|promos|promocion|promociones|oferta|ofertas|descuento|descuentos|2x1)\b/ },
  { name: 'horario', pattern: /\b(horario|a que hora|que hora|abren|abiertos?|cierran|hasta que hora|estan abierto)\b/ },
  { name: 'zonas', pattern: /\b(zona|zonas|reparten|reparto|llegan a|envian a|cuanto sale el envio|hacen envios?|delivery a)\b/ },
  { name: 'pagos', pattern: /\b(que medios|cuales medios|como pago|formas? de pago|medios de pago|aceptan tarjeta)\b/ },
  { name: 'estado', pattern: /\b(estado|como viene|cuanto falta|ya salio|mi pedido|donde esta|demora)\b/ },
  { name: 'humano', pattern: /\b(humano|persona|encargado|dueno|hablar con|reclamo|queja|problema)\b/ },
  { name: 'comprobante', pattern: /\b(comprobante|transferi|ya pague|pague|adjunto|captura)\b/ },
  { name: 'cancelar', pattern: /\b(cancelar|anular|dar de baja)\b/ },
  { name: 'saludo', pattern: /\b(hola|buenas|buen dia|buenas tardes|buenas noches|hey|holis)\b/ },
  { name: 'gracias', pattern: /\b(gracias|genial|barbaro|joya|buenisimo|chau|nos vemos)\b/ },
];

/**
 * Si el cliente está preguntando en vez de contestando.
 *
 * Es lo que separa "Centro" (respuesta al barrio) de "¿a qué zonas llegan?"
 * (consulta), sin tener que enumerar todos los barrios del país.
 */
function looksLikeQuestion(text: string): boolean {
  if (text.includes('?') || text.includes('¿')) return true;
  // Sobre el texto normalizado: ahí "qué" ya es "que", así que alcanza con las
  // formas sin tilde.
  return /^(que|cual|cuales|cuanto|como|donde|hay|tenes|tienen|se puede|puedo)\b/.test(
    normalize(text),
  );
}

function detectIntents(text: string): Set<string> {
  const clean = normalize(text);
  return new Set(INTENTS.filter((intent) => intent.pattern.test(clean)).map((intent) => intent.name));
}

// Sin límite de palabra al final: "transferencia", "transferí" y "transfiero"
// son la misma respuesta, y exigir la palabra exacta dejaría al cliente
// repitiendo el medio de pago hasta cansarse.
const PAYMENT_ANSWER = /\b(transferen|transferi|transfier|mercado ?pago|mp\b|efectivo|debito|credito|tarjeta|contra ?entrega)/;
const TYPE_ANSWER = /\b(envio|envian|delivery|domicilio|casa|retiro|retirar|paso|busco|llevar|local|mesa|salon|ahi)\b/;

// ---------------------------------------------------------------------------
// Redacción de las respuestas
// ---------------------------------------------------------------------------

function renderMenu(result: Record<string, unknown>): string {
  const categorias = (result.categorias ?? []) as {
    categoria: string;
    productos: { nombre: string; opciones: { nombre: string; precio: string }[] }[];
  }[];

  if (categorias.length === 0) {
    return 'No encontré eso en la carta. ¿Querés que te pase el menú completo?';
  }

  const bloques = categorias.map((categoria) => {
    const lineas = categoria.productos.map((producto) => {
      const opciones = producto.opciones
        .map((opcion) => `${opcion.nombre} ${opcion.precio}`)
        .join(' · ');
      return `• ${producto.nombre}${opciones ? ` — ${opciones}` : ''}`;
    });
    return `*${categoria.categoria}*\n${lineas.join('\n')}`;
  });

  return `${bloques.join('\n\n')}\n\nDecime qué querés y te armo el pedido 🍕`;
}

function renderPromos(result: Record<string, unknown>): string {
  const promociones = (result.promociones ?? []) as { titulo: string; detalle: string }[];
  if (promociones.length === 0) {
    return 'Hoy no tenemos promos activas, pero podés ver la carta si querés 😉';
  }
  const lineas = promociones.map((promo) => `• *${promo.titulo}*: ${promo.detalle}`);
  return `Promos de hoy:\n${lineas.join('\n')}`;
}

function renderHorario(result: Record<string, unknown>): string {
  if (typeof result.horario !== 'string' || !result.horario) {
    // El comercio no cargó el horario. Antes que arriesgar uno, se deriva.
    return 'No tengo el horario a mano. Te paso con alguien del local que te lo confirme.';
  }
  return `Atendemos ${result.horario}.\n\n¿Te armo un pedido?`;
}

function renderZonas(result: Record<string, unknown>): string {
  const zonas = (result.zonas ?? []) as { nombre: string; costo: string; demoraMinutos: number | null }[];
  if (zonas.length === 0) return 'Por ahora no estamos haciendo envíos, pero podés pasar a retirar.';
  const lineas = zonas.map(
    (zona) => `• ${zona.nombre}: ${zona.costo}${zona.demoraMinutos ? ` (~${zona.demoraMinutos} min)` : ''}`,
  );
  return `Estas son las zonas a las que llegamos:\n${lineas.join('\n')}\n\n¿A qué dirección te lo mandamos?`;
}

function renderPagos(result: Record<string, unknown>): string {
  const medios = (result.medios ?? []) as {
    nombre: string;
    pagoPorAdelantado: boolean;
    instrucciones: string | null;
  }[];
  if (medios.length === 0) return 'Ahora mismo no tengo medios de pago cargados. Te paso con alguien del local.';

  const lineas = medios.map(
    (medio) => `• ${medio.nombre}${medio.pagoPorAdelantado ? ' (se paga antes de preparar)' : ''}`,
  );
  return `Podés pagar con:\n${lineas.join('\n')}`;
}

function renderResumen(result: Record<string, unknown>): string {
  const resumen = result.resumen as {
    items: { cantidad: number; producto: string; importe: string }[];
    subtotal: string;
    envio: string | null;
    total: string;
  };
  const lineas = resumen.items.map((item) => `• ${item.cantidad}x ${item.producto} — ${item.importe}`);
  const envio = resumen.envio ? `\nEnvío: ${resumen.envio}` : '';
  return `${lineas.join('\n')}${envio}\n*Total: ${resumen.total}*`;
}

/** Qué preguntar según lo que falta. El orden importa: primero lo que traba todo. */
function askForMissing(faltan: string[]): string {
  const first = faltan[0];
  switch (first) {
    case 'items':
      return '¿Qué te gustaría pedir? Si querés te paso la carta.';
    case 'modalidad':
      return '¿Es para envío, para retirar por el local o para comer acá?';
    case 'direccion':
      return '¿A qué dirección te lo mandamos? (calle, número y apto si tenés)';
    case 'zona':
      return '¿En qué barrio queda? Así te digo cuánto sale el envío.';
    case 'medio_de_pago':
      return '¿Cómo lo vas a pagar?';
    default:
      return '¿Confirmo el pedido?';
  }
}

function renderArmarPedido(result: Record<string, unknown>): string {
  if (typeof result.error === 'string') {
    const medios = (result.medios_disponibles ?? []) as string[];
    return `${result.error}.${medios.length ? ` Podés pagar con: ${medios.join(', ')}.` : ''}`;
  }

  if (typeof result.zona_no_reconocida === 'string') {
    const zonas = (result.zonas_disponibles ?? []) as string[];
    return (
      `No estamos repartiendo en ${result.zona_no_reconocida} 😕\n` +
      (zonas.length ? `Llegamos a: ${zonas.join(', ')}.\n` : '') +
      '¿Te queda cerca alguna de esas? Si no, podés pasar a retirarlo por el local.'
    );
  }

  const noEncontrados = (result.no_encontrados ?? []) as string[];
  const aviso = noEncontrados.length
    ? `No encontré "${noEncontrados.join('", "')}" en la carta.\n\n`
    : '';

  const resumen = (result.resumen as { items: unknown[] } | undefined)?.items ?? [];
  if (resumen.length === 0) {
    return `${aviso}${askForMissing(['items'])}`;
  }

  const faltan = (result.faltan ?? []) as string[];
  const cuerpo = `Te va quedando así:\n${renderResumen(result)}`;

  if (faltan.length === 0) {
    return `${aviso}${cuerpo}\n\n¿Confirmo el pedido?`;
  }
  return `${aviso}${cuerpo}\n\n${askForMissing(faltan)}`;
}

function renderConfirmacion(result: Record<string, unknown>): string {
  if (typeof result.error === 'string') {
    const faltan = (result.faltan ?? []) as string[];
    return askForMissing(faltan);
  }

  const base = `¡Listo! Tu pedido es el *#${result.numero}* por ${result.total}.`;

  if (result.requiere_pago_antes === true) {
    const datos = result.instrucciones_de_pago ? `\n\n${result.instrucciones_de_pago}` : '';
    const qr = result.qr ? `\n\nQR para pagar: ${result.qr}` : '';
    return (
      `${base}\n\nPara ponerlo en marcha necesitamos el pago por adelantado.${datos}${qr}` +
      '\n\nCuando pagues, mandame la captura del comprobante por acá y lo mandamos a la cocina 👍'
    );
  }

  return `${base}\n\nYa lo mandamos a la cocina. Te aviso cuando esté 🍕`;
}

function renderEstado(result: Record<string, unknown>): string {
  if (result.encontrado !== true) {
    return 'No encontré ningún pedido tuyo. ¿Querés hacer uno?';
  }

  const estados: Record<string, string> = {
    PENDIENTE: 'está tomado y esperando que lo confirmen',
    CONFIRMADO: 'está confirmado, entra a la cocina en breve',
    EN_PREPARACION: 'se está preparando ahora 👨‍🍳',
    LISTO: 'ya está listo',
    EN_CAMINO: 'ya salió para tu dirección 🛵',
    ENTREGADO: 'figura como entregado',
    CANCELADO: 'figura como cancelado',
  };

  const estado = estados[String(result.estado)] ?? 'está en curso';
  const pago =
    result.estado_del_pago === 'PENDING'
      ? '\n\nOjo: todavía figura sin pagar, por eso no entró a la cocina.'
      : result.estado_del_pago === 'PROOF_SUBMITTED'
        ? '\n\nRecibimos tu comprobante, lo están verificando.'
        : '';

  return `Tu pedido #${result.numero} ${estado}.${pago}`;
}

function renderComprobante(result: Record<string, unknown>): string {
  if (result.registrado === true) {
    return (
      `Recibí el comprobante del pedido #${result.numero}, gracias 🙌\n` +
      'Lo verifican en el local y apenas confirmen te aviso y lo mandamos a la cocina.'
    );
  }
  if (result.motivo === 'Hace falta la captura del comprobante') {
    return '¿Me mandás la captura del comprobante? Con la imagen lo puedo registrar.';
  }
  return 'No tengo ningún pedido tuyo esperando pago. ¿Querés hacer uno?';
}

function renderToolResult(echo: ToolEcho): LlmCompletion {
  switch (echo.name) {
    case 'ver_menu':
      return say(renderMenu(echo.result));
    case 'ver_horario':
      return say(renderHorario(echo.result));
    case 'ver_promociones':
      return say(renderPromos(echo.result));
    case 'ver_zonas_de_envio':
      return say(renderZonas(echo.result));
    case 'ver_medios_de_pago':
      return say(renderPagos(echo.result));
    case 'armar_pedido':
      return say(renderArmarPedido(echo.result));
    case 'confirmar_pedido':
      return say(renderConfirmacion(echo.result));
    case 'consultar_pedido':
      return say(renderEstado(echo.result));
    case 'registrar_comprobante':
      return say(renderComprobante(echo.result));
    case 'vaciar_pedido':
      return say('Listo, borré el pedido. ¿Arrancamos de nuevo?');
    case 'derivar_a_persona':
      return say('Te paso con alguien del local, en un ratito te responden 🙌');
    default:
      return say('Perfecto. ¿Te ayudo con algo más?');
  }
}

const AYUDA =
  'Puedo ayudarte con:\n' +
  '• *Carta* y precios\n' +
  '• *Promos* de hoy\n' +
  '• Armarte un pedido para envío o retiro\n' +
  '• Contarte cómo viene tu pedido\n\n' +
  '¿Qué necesitás?';

// ---------------------------------------------------------------------------
// Decisión
// ---------------------------------------------------------------------------

export class ScriptedLlmProvider implements LlmProvider {
  readonly name = 'scripted';

  // Async porque lo pide la interfaz: acá no hay nada que esperar, y ese es
  // justamente el punto de este proveedor.
  async complete(request: LlmRequest): Promise<LlmCompletion> {
    const last = request.messages.at(-1);
    if (!last) return say(AYUDA);

    // Vuelta de una herramienta: toca redactar lo que se le dice al cliente.
    if (last.role === 'tool') {
      return renderToolResult({
        name: last.name,
        result: safeParse(last.content),
      });
    }

    if (last.role !== 'user') return say(AYUDA);
    return this.decide(last.content, request.state ?? {});
  }

  /**
   * El estado del pedido en curso llega del borrador guardado, no del
   * historial: alguien contesta "dale" tres horas después y hay que saber a
   * qué le está diciendo que sí.
   */
  private decide(text: string, state: Record<string, unknown>): LlmCompletion {
    const clean = normalize(text);
    const intents = detectIntents(text);

    if (text.includes(IMAGE_MARKER) || intents.has('comprobante')) {
      const nota = text.replace(IMAGE_MARKER, '').trim();
      return toolCall('registrar_comprobante', nota ? { nota } : {});
    }

    if (intents.has('humano') || intents.has('cancelar')) {
      return toolCall('derivar_a_persona', {
        motivo: intents.has('cancelar')
          ? 'El cliente quiere cancelar un pedido'
          : 'El cliente pidió hablar con una persona',
      });
    }

    const hayPedidoEnCurso = Array.isArray(state.items) && state.items.length > 0;
    const faltan = (state.faltan ?? []) as string[];
    const listo = state.listo_para_confirmar === true;
    const esperando = faltan[0];

    // Confirmación del pedido armado.
    if (listo && YES.test(clean) && !NO.test(clean)) return toolCall('confirmar_pedido');
    if (listo && NO.test(clean) && !YES.test(clean)) {
      return say('Sin problema. Decime qué querés cambiar y lo ajusto.');
    }

    /**
     * Respuesta a lo que se le acaba de preguntar.
     *
     * Va antes que las consultas generales porque, cuando se le preguntó el
     * barrio, "Centro" es la respuesta y no un pedido de ver las zonas. Sólo
     * cede el paso cuando el cliente pregunta algo en vez de contestar.
     */
    if (esperando && !looksLikeQuestion(text)) {
      // El medio de pago se reconoce en cualquier momento: si lo dice mientras
      // se le pregunta el barrio, tomarlo como barrio sería absurdo.
      if (PAYMENT_ANSWER.test(clean)) {
        return toolCall('armar_pedido', { medio_de_pago: text });
      }
      if (esperando === 'zona') {
        return toolCall('armar_pedido', { direccion: { barrio: text } });
      }
      if (esperando === 'direccion') {
        const direccion = parseAddress(text);
        if (direccion) return toolCall('armar_pedido', { direccion });
      }
      if (esperando === 'modalidad' && TYPE_ANSWER.test(clean)) {
        return toolCall('armar_pedido', { modalidad: text });
      }
    }

    if (intents.has('horario')) return toolCall('ver_horario');
    if (intents.has('promos')) return toolCall('ver_promociones');
    // Las zonas se miran antes que la carta: "¿cuánto sale el envío?" dispara
    // las dos, y la respuesta útil es la del envío.
    if (intents.has('zonas')) return toolCall('ver_zonas_de_envio');
    if (intents.has('menu')) return toolCall('ver_menu');
    if (intents.has('estado')) return toolCall('consultar_pedido');
    if (intents.has('pagos')) return toolCall('ver_medios_de_pago');

    // Productos nombrados en el mensaje.
    const items = parseRequestedItems(text)
      .filter((item) => item.text.length >= 3)
      .map((item) => ({ texto: item.text, cantidad: item.quantity }));

    if (items.length > 0 && !intents.has('saludo')) {
      const modalidad = TYPE_ANSWER.test(clean) ? text : undefined;
      return toolCall('armar_pedido', { items, ...(modalidad ? { modalidad } : {}) });
    }

    // Modalidad suelta ("es para envío") sin nada más.
    if (TYPE_ANSWER.test(clean) && hayPedidoEnCurso) {
      return toolCall('armar_pedido', { modalidad: text });
    }

    if (intents.has('saludo')) {
      return say(`¡Hola! 👋 Soy el asistente del local.\n\n${AYUDA}`);
    }
    if (intents.has('gracias')) {
      return say('¡Gracias a vos! Cualquier cosa escribime por acá 🙌');
    }

    // Sin idea de qué quiere. Antes que inventar, se pregunta.
    return say(`Perdón, no te entendí bien 😅\n\n${AYUDA}`);
  }
}

function safeParse(content: string): Record<string, unknown> {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}
