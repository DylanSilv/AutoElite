import type {
  CategoryDto,
  CustomerDto,
  DeliveryZoneDto,
  ModifierGroupDto,
  Page,
  PaymentMethodDto,
  ProductDto,
} from '@autoelite/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

interface Wrapped<T> {
  data: T;
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<Wrapped<CategoryDto[]>>('/categories')).data,
  });
}

export function useProducts(filters: { search?: string; categoryId?: string } = {}) {
  const params = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => Boolean(value)) as [string, string][],
  );
  return useQuery({
    queryKey: ['products', filters],
    queryFn: async () => (await api.get<Wrapped<ProductDto[]>>(`/products?${params}`)).data,
  });
}

export function useModifierGroups() {
  return useQuery({
    queryKey: ['modifier-groups'],
    queryFn: async () => (await api.get<Wrapped<ModifierGroupDto[]>>('/modifier-groups')).data,
  });
}

export function useDeliveryZones() {
  return useQuery({
    queryKey: ['delivery-zones'],
    queryFn: async () => (await api.get<Wrapped<DeliveryZoneDto[]>>('/delivery-zones')).data,
  });
}

export function usePaymentMethods() {
  return useQuery({
    queryKey: ['payment-methods'],
    queryFn: async () => (await api.get<Wrapped<PaymentMethodDto[]>>('/payment-methods')).data,
  });
}

/**
 * Corta o repone un producto.
 *
 * Se actualiza de forma optimista porque es una acción que se hace en medio del
 * servicio y la espera se nota.
 */
export function useToggleAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) =>
      api.patch<ProductDto>(`/products/${id}/availability`, { isAvailable }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useCustomers(filters: { search?: string } = {}) {
  const params = new URLSearchParams({ limit: '50' });
  if (filters.search) params.set('search', filters.search);
  return useQuery({
    queryKey: ['customers', filters],
    queryFn: () => api.get<Page<CustomerDto>>(`/customers?${params}`),
  });
}

/** Búsqueda exacta por teléfono, para reconocer al cliente al cargar un pedido. */
export function useCustomerByPhone(phone: string) {
  return useQuery({
    queryKey: ['customers', 'by-phone', phone],
    queryFn: async () =>
      (await api.get<Wrapped<CustomerDto | null>>(`/customers/by-phone?phone=${encodeURIComponent(phone)}`))
        .data,
    // Se consulta recién cuando hay suficientes dígitos como para ser un número.
    enabled: phone.replace(/\D/g, '').length >= 8,
  });
}
