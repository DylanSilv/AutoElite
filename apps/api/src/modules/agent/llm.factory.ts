import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import { AnthropicLlmProvider } from './llm.anthropic.js';
import { OpenAiLlmProvider } from './llm.openai.js';
import { ScriptedLlmProvider } from './llm.scripted.js';
import { LlmPermanentError, type LlmCompletion, type LlmProvider, type LlmRequest } from './llm.provider.js';

/**
 * Elección del proveedor de IA, en un único lugar.
 *
 * El resto del sistema pide `getLlmProvider()` y no sabe cuál le tocó.
 */

const DEFAULT_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
};

let provider: LlmProvider | null = null;

function build(): LlmProvider {
  if (env.LLM_PROVIDER === 'scripted') return new ScriptedLlmProvider();

  const options = {
    apiKey: env.LLM_API_KEY as string,
    model: env.LLM_MODEL as string,
    baseUrl: (env.LLM_BASE_URL ?? DEFAULT_BASE_URLS[env.LLM_PROVIDER] ?? '').replace(/\/$/, ''),
    maxTokens: env.LLM_MAX_TOKENS,
    timeoutMs: env.LLM_TIMEOUT_MS,
  };

  const remote =
    env.LLM_PROVIDER === 'anthropic'
      ? new AnthropicLlmProvider(options)
      : new OpenAiLlmProvider(options);

  // Un proveedor caído no puede dejar al negocio sin atender el WhatsApp: se
  // responde con el asistente por reglas, que entiende menos pero contesta.
  return new FallbackLlmProvider(remote, new ScriptedLlmProvider());
}

export function getLlmProvider(): LlmProvider {
  provider ??= build();
  return provider;
}

/** Sólo para tests: reemplaza el proveedor y lo restituye con `null`. */
export function setLlmProvider(next: LlmProvider | null): void {
  provider = next;
}

class FallbackLlmProvider implements LlmProvider {
  readonly name: string;

  constructor(
    private readonly primary: LlmProvider,
    private readonly backup: LlmProvider,
  ) {
    this.name = `${primary.name}+${backup.name}`;
  }

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    try {
      return await this.primary.complete(request);
    } catch (err) {
      logger.error(
        { err, provider: this.primary.name, permanent: err instanceof LlmPermanentError },
        'El proveedor de IA falló: se responde con el asistente por reglas',
      );
      return this.backup.complete(request);
    }
  }
}
