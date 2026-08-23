import type {
  CancelOrderInput,
  ChangeStatusInput,
  CreateOrderInput,
  DashboardDto,
  OrderBoardDto,
  OrderDto,
  OrderQuoteDto,
  OrderSummaryDto,
  Page,
  QuoteOrderInput,
} from '@autoelite/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

/**
 * Todo el acceso a la API pasa por hooks: ningún componente llama a fetch.
 *
 * El tablero se refresca por polling. Para el volumen de una pizzería alcanza
 * de sobra, y el contrato ya está listo para pasar a SSE sin tocar la UI.
 */

const BOARD_REFETCH_MS = 12_000;

export function useBoard() {
  return useQuery({
    queryKey: ['orders', 'board'],
    queryFn: () => api.get<OrderBoardDto>('/orders/board'),
    refetchInterval: BOARD_REFETCH_MS,
    // Sin la pestaña a la vista no tiene sentido consultar.
    refetchIntervalInBackground: false,
  });
}

export function useOrder(id: string | null) {
  return useQuery({
    queryKey: ['orders', 'detail', id],
    queryFn: () => api.get<OrderDto>(`/orders/${id}`),
    enabled: Boolean(id),
  });
}

export function useOrderHistory(filters: Record<string, string>) {
  const params = new URLSearchParams({ limit: '30', ...filters });
  return useQuery({
    queryKey: ['orders', 'history', filters],
    queryFn: () => api.get<Page<OrderSummaryDto>>(`/orders?${params.toString()}`),
  });
}

export function useDashboard(range: { from?: string; to?: string }) {
  const params = new URLSearchParams(
    Object.entries(range).filter(([, value]) => Boolean(value)) as [string, string][],
  );
  return useQuery({
    queryKey: ['dashboard', range],
    queryFn: () => api.get<DashboardDto>(`/reports/dashboard?${params.toString()}`),
  });
}

/** Invalida todo lo que un pedido puede haber cambiado. */
function useOrderInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['customers'] });
  };
}

export function useQuoteOrder() {
  return useMutation({
    mutationFn: (input: QuoteOrderInput) => api.post<OrderQuoteDto>('/orders/quote', input),
  });
}

export function useCreateOrder() {
  const invalidate = useOrderInvalidation();
  return useMutation({
    mutationFn: (input: CreateOrderInput) =>
      // Clave de idempotencia por intento: si el navegador reintenta, no se
      // crean dos comandas.
      api.post<OrderDto>('/orders', input, { 'Idempotency-Key': crypto.randomUUID() }),
    onSuccess: invalidate,
  });
}

export function useChangeStatus() {
  const invalidate = useOrderInvalidation();
  return useMutation({
    mutationFn: ({ id, ...input }: ChangeStatusInput & { id: string }) =>
      api.post<OrderDto>(`/orders/${id}/status`, input),
    onSuccess: invalidate,
  });
}

export function useConfirmPayment() {
  const invalidate = useOrderInvalidation();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      api.post<OrderDto>(`/orders/${id}/payment/confirm`, { note }),
    onSuccess: invalidate,
  });
}

export function useRejectPayment() {
  const invalidate = useOrderInvalidation();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.post<OrderDto>(`/orders/${id}/payment/reject`, { note }),
    onSuccess: invalidate,
  });
}

export function useCancelOrder() {
  const invalidate = useOrderInvalidation();
  return useMutation({
    mutationFn: ({ id, ...input }: CancelOrderInput & { id: string }) =>
      api.post<OrderDto>(`/orders/${id}/cancel`, input),
    onSuccess: invalidate,
  });
}
