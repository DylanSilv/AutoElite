import type {
  AgentReplyDto,
  ConversationDto,
  ConversationStatus,
  ConversationSummaryDto,
  InboundMessageInput,
  Page,
  PromotionDto,
} from '@autoelite/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

/** Cada cuánto se refrescan las conversaciones abiertas. */
const REFETCH_MS = 10_000;

export function useConversations(status?: ConversationStatus) {
  const params = new URLSearchParams({ limit: '40', ...(status ? { status } : {}) });
  return useQuery({
    queryKey: ['conversations', status ?? 'todas'],
    queryFn: () => api.get<Page<ConversationSummaryDto>>(`/agent/conversations?${params}`),
    refetchInterval: REFETCH_MS,
    refetchIntervalInBackground: false,
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: ['conversations', 'detail', id],
    queryFn: () => api.get<ConversationDto>(`/agent/conversations/${id}`),
    enabled: Boolean(id),
    refetchInterval: REFETCH_MS,
  });
}

function useConversationInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    // Una charla puede haber terminado en un pedido.
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
  };
}

/**
 * Simulador: manda un mensaje como si lo escribiera un cliente.
 *
 * Usa exactamente el mismo endpoint que cualquier integración, así que lo que
 * se ve acá es lo que va a pasar por WhatsApp.
 */
export function useSimulateMessage() {
  const invalidate = useConversationInvalidation();
  return useMutation({
    mutationFn: (input: InboundMessageInput) => api.post<AgentReplyDto>('/agent/messages', input),
    onSuccess: invalidate,
  });
}

export function useHandOff() {
  const invalidate = useConversationInvalidation();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<ConversationDto>(`/agent/conversations/${id}/handoff`, { reason }),
    onSuccess: invalidate,
  });
}

export function useResumeBot() {
  const invalidate = useConversationInvalidation();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      api.post<ConversationDto>(`/agent/conversations/${id}/resume`, {}),
    onSuccess: invalidate,
  });
}

export function useStaffReply() {
  const invalidate = useConversationInvalidation();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      api.post<ConversationDto>(`/agent/conversations/${id}/reply`, { text }),
    onSuccess: invalidate,
  });
}

// ---------- Promociones ----------

export function usePromotions(includeInactive = false) {
  return useQuery({
    queryKey: ['promotions', includeInactive],
    queryFn: () =>
      api.get<{ data: PromotionDto[] }>(
        `/promotions${includeInactive ? '?includeInactive=true' : ''}`,
      ),
  });
}

export function useTogglePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch<PromotionDto>(`/promotions/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promotions'] }),
  });
}
