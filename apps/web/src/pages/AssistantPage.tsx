import {
  CONVERSATION_CHANNEL_LABELS,
  CONVERSATION_STATUS_LABELS,
  type ConversationMessageDto,
  type ConversationStatus,
  type ConversationSummaryDto,
} from '@autoelite/shared';
import clsx from 'clsx';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Card, EmptyState, ErrorMessage, Input, Spinner } from '@/components/ui';
import {
  useConversation,
  useConversations,
  useHandOff,
  useResumeBot,
  useSimulateMessage,
  useStaffReply,
} from '@/features/agent/agent.api';
import { time } from '@/lib/format';

/**
 * El asistente de WhatsApp, visto desde el local.
 *
 * Dos cosas en una pantalla: mirar y retomar las conversaciones reales, y
 * probar el asistente escribiéndole como si fuera un cliente. El simulador usa
 * el mismo endpoint que WhatsApp, así que lo que se ve acá es lo que va a
 * pasar de verdad.
 */

const FILTERS: { value: ConversationStatus | 'TODAS'; label: string }[] = [
  { value: 'TODAS', label: 'Todas' },
  { value: 'HUMAN', label: 'Necesitan a alguien' },
  { value: 'BOT', label: 'Atiende el asistente' },
];

function statusTone(status: ConversationStatus) {
  if (status === 'HUMAN') return 'amber' as const;
  if (status === 'CLOSED') return 'slate' as const;
  return 'emerald' as const;
}

function ConversationRow({
  conversation,
  selected,
  onSelect,
}: {
  conversation: ConversationSummaryDto;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      className={clsx(
        'w-full rounded-lg border-l-4 p-3 text-left transition',
        selected ? 'border-l-brand-500 bg-brand-50' : 'border-l-transparent hover:bg-slate-50',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold text-slate-900">
          {conversation.contactName ?? conversation.phoneE164}
        </span>
        <span className="shrink-0 text-xs text-slate-400">{time(conversation.lastMessageAt)}</span>
      </div>
      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
        {conversation.lastMessagePreview || 'Sin mensajes'}
      </p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Badge tone={statusTone(conversation.status)}>
          {CONVERSATION_STATUS_LABELS[conversation.status]}
        </Badge>
        {conversation.channel === 'SIMULATOR' && <Badge tone="violet">Simulador</Badge>}
      </div>
    </button>
  );
}

function MessageBubble({ message }: { message: ConversationMessageDto }) {
  // Los resultados de herramientas se muestran plegados: son la trazabilidad de
  // de dónde salió cada dato, no algo que el personal necesite leer siempre.
  if (message.role === 'TOOL') {
    return (
      <details className="mx-auto w-full max-w-md text-xs text-slate-400">
        <summary className="cursor-pointer text-center">
          consultó <span className="font-mono">{message.toolName}</span>
        </summary>
        <pre className="mt-1 overflow-x-auto rounded bg-slate-100 p-2 text-[11px] text-slate-600">
          {message.body}
        </pre>
      </details>
    );
  }

  const fromCustomer = message.role === 'CUSTOMER';

  return (
    <div className={clsx('flex', fromCustomer ? 'justify-start' : 'justify-end')}>
      <div
        className={clsx(
          'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm',
          fromCustomer
            ? 'rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200'
            : message.role === 'STAFF'
              ? 'rounded-br-sm bg-amber-100 text-amber-900'
              : 'rounded-br-sm bg-brand-600 text-white',
        )}
      >
        {message.body}
        {message.mediaId && (
          <p className={clsx('mt-1 text-xs', fromCustomer ? 'text-slate-400' : 'text-white/70')}>
            📎 imagen adjunta
          </p>
        )}
        <p className={clsx('mt-1 text-[10px]', fromCustomer ? 'text-slate-400' : 'text-white/60')}>
          {message.role === 'STAFF' ? 'Vos · ' : ''}
          {time(message.createdAt)}
        </p>
      </div>
    </div>
  );
}

function Transcript({ conversationId }: { conversationId: string }) {
  const { data, isLoading, error } = useConversation(conversationId);
  const handOff = useHandOff();
  const resume = useResumeBot();
  const reply = useStaffReply();
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages.length]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="size-8" />
      </div>
    );
  }
  if (error) return <ErrorMessage error={error} />;
  if (!data) return null;

  const enviar = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    reply.mutate(
      { id: data.id, text: text.trim() },
      { onSuccess: () => setText('') },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">
            {data.contactName ?? data.phoneE164}
          </p>
          <p className="text-xs text-slate-500">
            {data.phoneE164} · {CONVERSATION_CHANNEL_LABELS[data.channel]}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge tone={statusTone(data.status)}>{CONVERSATION_STATUS_LABELS[data.status]}</Badge>
          {data.status === 'BOT' ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={handOff.isPending}
              onClick={() =>
                handOff.mutate({ id: data.id, reason: 'La tomó alguien del local' })
              }
            >
              Atender yo
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={resume.isPending}
              onClick={() => resume.mutate({ id: data.id })}
            >
              Devolver al asistente
            </Button>
          )}
        </div>
      </header>

      {data.handoffReason && data.status === 'HUMAN' && (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          El asistente dejó de responder: {data.handoffReason}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 p-4">
        {data.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={bottom} />
      </div>

      <form onSubmit={enviar} className="flex gap-2 border-t border-slate-200 p-3">
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Escribir como el local…"
          className="flex-1"
        />
        <Button type="submit" disabled={reply.isPending || !text.trim()}>
          Enviar
        </Button>
      </form>
      {/* Escribir a mano implica tomar la conversación: si no, el asistente y
          una persona le hablarían al cliente a la vez. */}
      {data.status === 'BOT' && (
        <p className="px-3 pb-3 text-xs text-slate-400">
          Si escribís, la conversación pasa a manos del local y el asistente deja de responder.
        </p>
      )}
    </div>
  );
}

/** Probador: escribirle al asistente como si fueras un cliente. */
function Simulator({ onOpen }: { onOpen: (id: string) => void }) {
  const simulate = useSimulateMessage();
  const [phone, setPhone] = useState('099 111 222');
  const [text, setText] = useState('');

  const enviar = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    simulate.mutate(
      { phone, text: text.trim(), channel: 'SIMULATOR', contactName: 'Cliente de prueba' },
      {
        onSuccess: (result) => {
          setText('');
          onOpen(result.conversation.id);
        },
      },
    );
  };

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-slate-900">Probar el asistente</h2>
      <p className="mt-1 text-xs text-slate-500">
        Escribile como si fueras un cliente. Usa el mismo camino que WhatsApp, pero no le manda
        nada a nadie.
      </p>

      <form onSubmit={enviar} className="mt-3 space-y-2">
        <Input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="Teléfono del cliente"
        />
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Hola, me pasás la carta?"
            className="flex-1"
          />
          <Button type="submit" disabled={simulate.isPending || !text.trim()}>
            {simulate.isPending ? <Spinner className="size-4" /> : 'Enviar'}
          </Button>
        </div>
      </form>

      {simulate.error != null && (
        <div className="mt-2">
          <ErrorMessage error={simulate.error} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {['Hola', '¿Qué promos tienen?', 'Quiero 2 muzzarella grandes', '¿Cómo viene mi pedido?'].map(
          (sugerencia) => (
            <button
              key={sugerencia}
              type="button"
              onClick={() => setText(sugerencia)}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200"
            >
              {sugerencia}
            </button>
          ),
        )}
      </div>
    </Card>
  );
}

export function AssistantPage() {
  const [filter, setFilter] = useState<ConversationStatus | 'TODAS'>('TODAS');
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading, error } = useConversations(filter === 'TODAS' ? undefined : filter);

  const conversations = data?.data ?? [];
  const pendientes = conversations.filter((c) => c.status === 'HUMAN').length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Asistente de WhatsApp</h1>
        <p className="text-sm text-slate-500">
          {conversations.length} {conversations.length === 1 ? 'conversación' : 'conversaciones'}
          {pendientes > 0 && (
            <span className="text-amber-700"> · {pendientes} esperando a una persona</span>
          )}
        </p>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[320px_1fr]">
        <div className="flex min-h-0 flex-col gap-3">
          <Simulator onOpen={setSelected} />

          <div className="flex gap-1">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                className={clsx(
                  'rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
                  filter === option.value
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <Card className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {isLoading ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : error ? (
              <ErrorMessage error={error} />
            ) : conversations.length === 0 ? (
              <EmptyState
                title="Sin conversaciones"
                description="Probá el asistente desde el simulador de arriba."
              />
            ) : (
              conversations.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  selected={conversation.id === selected}
                  onSelect={setSelected}
                />
              ))
            )}
          </Card>
        </div>

        <Card className="min-h-0 overflow-hidden">
          {selected ? (
            <Transcript conversationId={selected} />
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <EmptyState
                title="Elegí una conversación"
                description="O escribile al asistente desde el simulador para ver cómo responde."
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
