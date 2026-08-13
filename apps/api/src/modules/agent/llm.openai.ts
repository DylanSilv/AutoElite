import {
  LlmPermanentError,
  renderState,
  type LlmCompletion,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmToolCall,
} from './llm.provider.js';
import type { RemoteLlmOptions } from './llm.anthropic.js';

/**
 * Proveedor sobre el formato de chat de OpenAI.
 *
 * Sirve para OpenAI y para cualquier servicio que lo imite —que hoy son casi
 * todos, incluidos los modelos que se corren en una máquina propia—, cambiando
 * únicamente `LLM_BASE_URL`. Es la salida barata si el costo por conversación
 * se vuelve un problema.
 */

interface OpenAiResponse {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  error?: { message?: string };
}

function toOpenAiMessages(request: LlmRequest): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [
    { role: 'system', content: `${request.system}${renderState(request.state)}` },
  ];

  for (const message of request.messages) {
    if (message.role === 'tool') {
      messages.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: message.content || null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      });
      continue;
    }
    messages.push({ role: 'user', content: message.content });
  }

  return messages;
}

export class OpenAiLlmProvider implements LlmProvider {
  readonly name = 'openai';

  constructor(private readonly options: RemoteLlmOptions) {}

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    const response = await fetch(`${this.options.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        max_tokens: this.options.maxTokens,
        messages: toOpenAiMessages(request),
        tools: request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });

    const payload = (await response.json().catch(() => ({}))) as OpenAiResponse;

    if (!response.ok) {
      const message = payload.error?.message ?? `HTTP ${response.status}`;
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new LlmPermanentError(message);
      }
      throw new Error(message);
    }

    const choice = payload.choices?.[0]?.message;
    const toolCalls: LlmToolCall[] = (choice?.tool_calls ?? [])
      .filter((call) => call.function?.name)
      .map((call, index) => ({
        id: call.id ?? `call-${index}`,
        name: call.function?.name as string,
        arguments: parseArguments(call.function?.arguments),
      }));

    return { text: choice?.content?.trim() || null, toolCalls };
  }
}

/**
 * Los argumentos vienen como texto JSON y a veces mal formados. Un pedido
 * ilegible se trata como llamada sin argumentos: la herramienta va a responder
 * qué le falta, que es mejor que cortar la conversación.
 */
function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
