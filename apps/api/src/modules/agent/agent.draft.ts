import type { OrderType } from '@autoelite/shared';

/**
 * Pedido a medio armar.
 *
 * Se guarda en la conversación (columna `draft`) y no en memoria: una charla
 * por WhatsApp se retoma horas más tarde, posiblemente contra otra instancia de
 * la API, y el personal tiene que poder ver qué está pidiendo alguien antes de
 * que termine de decidirse.
 */

export interface DraftItem {
  variantId: string;
  quantity: number;
  /** Cómo mostrarlo en el resumen, sin volver a consultar el catálogo. */
  label: string;
  unitPriceCents: number;
  notes?: string;
}

export interface DraftAddress {
  street: string;
  number?: string;
  apartment?: string;
  neighborhood?: string;
  reference?: string;
}

export interface OrderDraft {
  type?: OrderType;
  items: DraftItem[];
  address?: DraftAddress;
  deliveryZoneId?: string;
  deliveryZoneName?: string;
  paymentMethodId?: string;
  paymentMethodName?: string;
  customerName?: string;
  notes?: string;
}

/**
 * Borrador nuevo.
 *
 * Es una función y no una constante a propósito: con un objeto compartido,
 * copiarlo con `{...EMPTY}` copiaría la *referencia* al array de items, y todas
 * las conversaciones terminarían empujando ítems al mismo array. En una
 * pizzería eso es el pedido de un cliente apareciendo en el de otro.
 */
export function emptyDraft(): OrderDraft {
  return { items: [] };
}

/** Deja el borrador vacío conservando el objeto, que otros mantienen referenciado. */
export function clearDraft(draft: OrderDraft): void {
  draft.items = [];
  for (const key of Object.keys(draft) as (keyof OrderDraft)[]) {
    if (key !== 'items') delete draft[key];
  }
}

/** Qué le falta al borrador para poder confirmarse, en el orden en que conviene pedirlo. */
export type MissingField = 'items' | 'modalidad' | 'direccion' | 'zona' | 'medio_de_pago';

export function missingFields(draft: OrderDraft): MissingField[] {
  const missing: MissingField[] = [];
  if (draft.items.length === 0) missing.push('items');
  if (!draft.type) missing.push('modalidad');
  // La dirección sólo hace falta si el pedido se manda; en retiro y salón
  // preguntarla sería puro ruido.
  if (draft.type === 'DELIVERY' && !draft.address) missing.push('direccion');
  // Una calle no dice a qué zona pertenece, y sin zona el envío se cobraría $0.
  // Preguntar el barrio es un mensaje más; adivinarlo sale del bolsillo del
  // comercio en cada pedido.
  if (draft.type === 'DELIVERY' && draft.address && !draft.deliveryZoneId) missing.push('zona');
  if (!draft.paymentMethodId) missing.push('medio_de_pago');
  return missing;
}

export function isReadyToConfirm(draft: OrderDraft): boolean {
  return missingFields(draft).length === 0;
}

/**
 * Lee el borrador de la columna Json.
 *
 * Tolera formas viejas o corruptas devolviendo un borrador vacío: perder un
 * pedido a medio armar es molesto, pero romper la conversación entera porque
 * cambió el formato es peor.
 */
export function parseDraft(value: unknown): OrderDraft {
  if (!value || typeof value !== 'object') return emptyDraft();
  const raw = value as Partial<OrderDraft>;
  return {
    ...raw,
    items: Array.isArray(raw.items) ? [...raw.items] : [],
  };
}
