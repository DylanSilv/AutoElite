import {
  LlmPermanentError,
  renderState,
  type LlmCompletion,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmToolCall,
} from './llm.provider.js';

/**
 * Proveedor sobre la API de mensajes de Anthropic.
 *
 * Traduce nuestro formato al suyo y vuelve. Nada del resto del sistema conoce
 * este archivo: cambiar de proveedor es escribir otro como este.
 */

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  content?: AnthropicBlock[];
  error?: { message?: string };
}

export interface RemoteLlmOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxTokens: number;
  timeoutMs: number;
}

/**
 * Un turno de asistente con herramientas viaja como bloques, y el resultado de
 * la herramienta vuelve como mensaje de usuario: es la forma que espera la API.
 */
function toAnthropicMessages(messages: LlmMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content },
        ],
      };
    }

    if (message.role === 'assistant') {
      const blocks: Record<string, unknown>[] = [];
      if (message.content) blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      return { role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '…' }] };
    }

    return { role: 'user', content: message.content };
  });
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic';

  constructor(private readonly options: RemoteLlmOptions) {}

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    const response = await fetch(`${this.options.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.options.model,
        max_tokens: this.options.maxTokens,
        system: `${request.system}${renderState(request.state)}`,
        messages: toAnthropicMessages(request.messages),
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });

    const payload = (await response.json().catch(() => ({}))) as AnthropicResponse;

    if (!response.ok) {
      const message = payload.error?.message ?? `HTTP ${response.status}`;
      // 4xx no se reintenta: la credencial o el pedido están mal y repetirlo
      // sólo gasta cuota.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new LlmPermanentError(message);
      }
      throw new Error(message);
    }

    const blocks = payload.content ?? [];
    const text = blocks
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text as string)
      .join('\n')
      .trim();

    const toolCalls: LlmToolCall[] = blocks
      .filter((block) => block.type === 'tool_use' && block.name)
      .map((block) => ({
        id: block.id ?? block.name ?? 'tool',
        name: block.name as string,
        arguments: block.input ?? {},
      }));

    return { text: text || null, toolCalls };
  }
}
