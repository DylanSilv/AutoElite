/**
 * Frontera con el modelo de lenguaje.
 *
 * Es la pieza que sostiene la decisión de arquitectura más importante del
 * proyecto: el producto es la API, y el proveedor de IA es un detalle
 * reemplazable. Todo lo que el asistente sabe hacer vive en las herramientas
 * (`agent.tools.ts`), que son código nuestro sobre nuestros services; el modelo
 * sólo decide cuál llamar y cómo redactar la respuesta.
 *
 * Consecuencia práctica: cambiar de Anthropic a OpenAI, a un modelo local o a
 * un motor de reglas se hace acá y en ningún otro lado. Y como el proveedor por
 * defecto no necesita credenciales, el flujo completo se puede probar y mostrar
 * sin contratar nada.
 */

export interface LlmToolDefinition {
  name: string;
  description: string;
  /** JSON Schema de los argumentos. */
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type LlmMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
  /**
   * Estado estructurado del pedido en curso.
   *
   * Va aparte del historial porque sobrevive entre mensajes: el cliente escribe
   * "dale" tres horas después y hay que saber a qué le está diciendo que sí.
   * Los proveedores remotos lo agregan al prompt de sistema; el de reglas lo lee
   * directamente.
   */
  state?: Record<string, unknown>;
}

/** Serializa el estado para meterlo en un prompt de sistema. */
export function renderState(state: Record<string, unknown> | undefined): string {
  if (!state || Object.keys(state).length === 0) return '';
  return `\n\nEstado actual del pedido en curso (JSON):\n${JSON.stringify(state, null, 2)}`;
}

export interface LlmCompletion {
  /** Texto para el cliente. Nulo cuando el turno es sólo llamadas a herramientas. */
  text: string | null;
  toolCalls: LlmToolCall[];
}

export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmCompletion>;
}

/**
 * Error del proveedor que no tiene sentido reintentar (credencial inválida,
 * pedido mal formado). Se distingue de una caída pasajera para no gastar
 * cuota repitiendo algo que va a fallar igual.
 */
export class LlmPermanentError extends Error {}
