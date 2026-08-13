import {
  ORDER_TYPES,
  ORDER_TYPE_LABELS,
  type CreateOrderInput,
  type OrderItemInput,
  type OrderType,
  type ProductDto,
  type VariantDto,
} from '@autoelite/shared';
import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, ErrorMessage, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import {
  useCategories,
  useCustomerByPhone,
  useDeliveryZones,
  usePaymentMethods,
  useProducts,
} from '@/features/catalog/catalog.api';
import { useCreateOrder, useQuoteOrder } from '@/features/orders/orders.api';
import { TYPE_ICON } from '@/features/orders/order-visuals';
import { money } from '@/lib/format';

interface CartLine {
  key: string;
  variantId: string;
  productName: string;
  variantName: string;
  unitPriceCents: number;
  quantity: number;
  modifierOptionIds: string[];
  notes: string;
}

/**
 * Alta de pedido.
 *
 * Es la pantalla que se repite cien veces por noche: todo en una sola vista,
 * sin asistente por pasos, y con el total calculado por el backend para que lo
 * que ve el operador sea exactamente lo que se va a guardar.
 */
export function NewOrderPage() {
  const navigate = useNavigate();

  const [type, setType] = useState<OrderType>('DELIVERY');
  const [phone, setPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [apartment, setApartment] = useState('');
  const [reference, setReference] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [paidWith, setPaidWith] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: categories } = useCategories();
  const { data: products, isLoading: loadingProducts } = useProducts({ search, categoryId });
  const { data: zones } = useDeliveryZones();
  const { data: paymentMethods } = usePaymentMethods();
  const { data: foundCustomer } = useCustomerByPhone(phone);

  const quote = useQuoteOrder();
  const createOrder = useCreateOrder();

  // Al reconocer el teléfono se completan nombre y dirección: el operador no
  // vuelve a pedir datos que el cliente ya dio otras veces.
  useEffect(() => {
    if (!foundCustomer) return;
    setCustomerId(foundCustomer.id);
    setCustomerName(foundCustomer.name);
    const address = foundCustomer.addresses.find((a) => a.isDefault) ?? foundCustomer.addresses[0];
    if (address) {
      setStreet(address.street);
      setNumber(address.number ?? '');
      setApartment(address.apartment ?? '');
      setReference(address.reference ?? '');
      if (address.deliveryZone) setZoneId(address.deliveryZone.id);
    }
  }, [foundCustomer]);

  const items: OrderItemInput[] = useMemo(
    () =>
      lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        modifierOptionIds: line.modifierOptionIds,
        ...(line.notes.trim() ? { notes: line.notes.trim() } : {}),
      })),
    [lines],
  );

  // El total lo calcula siempre el backend. Se pide con un pequeño retardo para
  // no disparar una consulta por cada tecla.
  const quoteMutate = quote.mutate;
  useEffect(() => {
    if (items.length === 0) {
      quote.reset();
      return;
    }
    const timeout = setTimeout(() => {
      quoteMutate({
        type,
        items,
        discountCents: 0,
        isPaid: false,
        source: 'PANEL',
        ...(type === 'DELIVERY' && street
          ? { address: { street, ...(zoneId ? { deliveryZoneId: zoneId } : {}) } }
          : {}),
      });
    }, 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, type, zoneId, street, quoteMutate]);

  const addLine = (product: ProductDto, variant: VariantDto) => {
    setLines((current) => {
      const existing = current.find(
        (line) => line.variantId === variant.id && line.modifierOptionIds.length === 0 && !line.notes,
      );
      if (existing) {
        return current.map((line) =>
          line.key === existing.key ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...current,
        {
          key: crypto.randomUUID(),
          variantId: variant.id,
          productName: product.name,
          variantName: variant.name,
          unitPriceCents: variant.priceCents,
          quantity: 1,
          modifierOptionIds: [],
          notes: '',
        },
      ];
    });
  };

  const updateLine = (key: string, patch: Partial<CartLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  const toggleModifier = (key: string, optionId: string) => {
    setLines((current) =>
      current.map((line) =>
        line.key === key
          ? {
              ...line,
              modifierOptionIds: line.modifierOptionIds.includes(optionId)
                ? line.modifierOptionIds.filter((id) => id !== optionId)
                : [...line.modifierOptionIds, optionId],
            }
          : line,
      ),
    );
  };

  const canSubmit =
    lines.length > 0 &&
    customerName.trim().length > 0 &&
    (type !== 'DELIVERY' || street.trim().length > 0) &&
    !createOrder.isPending;

  const submit = async () => {
    const payload: CreateOrderInput = {
      type,
      items,
      discountCents: 0,
      isPaid: false,
      source: 'PANEL',
      customerName: customerName.trim(),
      ...(customerId ? { customerId } : {}),
      ...(phone.trim() && !customerId ? { customerPhone: phone.trim() } : {}),
      ...(paymentMethodId ? { paymentMethodId } : {}),
      ...(paidWith ? { paidWithCents: Math.round(Number(paidWith) * 100) } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(type === 'DELIVERY'
        ? {
            address: {
              street: street.trim(),
              ...(number.trim() ? { number: number.trim() } : {}),
              ...(apartment.trim() ? { apartment: apartment.trim() } : {}),
              ...(reference.trim() ? { reference: reference.trim() } : {}),
              ...(zoneId ? { deliveryZoneId: zoneId } : {}),
            },
          }
        : {}),
    };

    const created = await createOrder.mutateAsync(payload);
    navigate('/', { state: { createdOrder: created.number } });
  };

  const productsByCategory = useMemo(() => {
    const groups = new Map<string, ProductDto[]>();
    for (const product of products ?? []) {
      const list = groups.get(product.category.name) ?? [];
      list.push(product);
      groups.set(product.category.name, list);
    }
    return [...groups.entries()];
  }, [products]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Modalidad</h2>
          <div className="grid grid-cols-3 gap-2">
            {ORDER_TYPES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setType(value)}
                className={clsx(
                  'rounded-lg px-3 py-3 text-sm font-medium ring-1 transition',
                  type === value
                    ? 'bg-brand-600 text-white ring-brand-600'
                    : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50',
                )}
              >
                <span className="mr-1">{TYPE_ICON[value]}</span>
                {ORDER_TYPE_LABELS[value]}
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Cliente</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Teléfono" hint={foundCustomer ? 'Cliente reconocido' : 'Se busca al tipear'}>
              <Input
                autoFocus
                inputMode="tel"
                placeholder="11 4567-8901"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setCustomerId(undefined);
                }}
              />
            </Field>
            <Field label="Nombre">
              <Input
                placeholder="Nombre del cliente"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </Field>
          </div>

          {foundCustomer && (
            <p className="mt-2 text-xs text-emerald-700">
              Cliente habitual · {foundCustomer.ordersCount} pedidos ·{' '}
              {money(foundCustomer.totalSpentCents)} gastados
            </p>
          )}

          {type === 'DELIVERY' && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Calle">
                <Input value={street} onChange={(e) => setStreet(e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Número">
                  <Input value={number} onChange={(e) => setNumber(e.target.value)} />
                </Field>
                <Field label="Piso/Depto">
                  <Input value={apartment} onChange={(e) => setApartment(e.target.value)} />
                </Field>
              </div>
              <Field label="Zona de envío">
                <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                  <option value="">Sin zona</option>
                  {zones?.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name} · {money(zone.feeCents)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Referencia">
                <Input
                  placeholder="Portón verde, timbre 2"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Productos</h2>
            <div className="ml-auto flex gap-2">
              <Input
                className="w-44"
                placeholder="Buscar…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Select
                className="w-40"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Todas</option>
                {categories?.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {loadingProducts ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : (
            <div className="space-y-4">
              {productsByCategory.map(([category, list]) => (
                <div key={category}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {category}
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {list.map((product) => (
                      <div
                        key={product.id}
                        className={clsx(
                          'rounded-lg p-2.5 ring-1',
                          product.isAvailable
                            ? 'bg-white ring-slate-200'
                            : 'bg-slate-50 opacity-60 ring-slate-200',
                        )}
                      >
                        <p className="text-sm font-medium text-slate-900">{product.name}</p>
                        {!product.isAvailable && <Badge tone="red">Sin stock</Badge>}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {product.variants
                            .filter((variant) => variant.isAvailable)
                            .map((variant) => (
                              <button
                                key={variant.id}
                                type="button"
                                disabled={!product.isAvailable}
                                onClick={() => addLine(product, variant)}
                                className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-brand-100 hover:text-brand-700 disabled:cursor-not-allowed"
                              >
                                {variant.name} · {money(variant.priceCents)}
                              </button>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Resumen</h2>

          {lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              Agregá productos desde la lista
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {lines.map((line) => {
                const product = products?.find((p) =>
                  p.variants.some((v) => v.id === line.variantId),
                );
                const isOpen = expanded === line.key;
                return (
                  <li key={line.key} className="py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {line.productName}
                        </p>
                        <p className="text-xs text-slate-500">{line.variantName}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="Quitar uno"
                          className="size-7 rounded bg-slate-100 text-slate-700 hover:bg-slate-200"
                          onClick={() =>
                            line.quantity === 1
                              ? removeLine(line.key)
                              : updateLine(line.key, { quantity: line.quantity - 1 })
                          }
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-sm font-semibold tabular-nums">
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label="Agregar uno"
                          className="size-7 rounded bg-slate-100 text-slate-700 hover:bg-slate-200"
                          onClick={() => updateLine(line.key, { quantity: line.quantity + 1 })}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {(product?.modifierGroups.length ?? 0) > 0 && (
                      <button
                        type="button"
                        className="mt-1 text-xs text-brand-700 hover:underline"
                        onClick={() => setExpanded(isOpen ? null : line.key)}
                      >
                        {isOpen ? 'Ocultar' : 'Extras y notas'}
                      </button>
                    )}

                    {isOpen && (
                      <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2">
                        {product?.modifierGroups.map((group) => (
                          <div key={group.id}>
                            <p className="mb-1 text-xs font-medium text-slate-600">{group.name}</p>
                            <div className="flex flex-wrap gap-1">
                              {group.options.map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => toggleModifier(line.key, option.id)}
                                  className={clsx(
                                    'rounded px-2 py-1 text-xs ring-1 transition',
                                    line.modifierOptionIds.includes(option.id)
                                      ? 'bg-brand-600 text-white ring-brand-600'
                                      : 'bg-white text-slate-600 ring-slate-300',
                                  )}
                                >
                                  {option.name}
                                  {option.priceDeltaCents > 0 &&
                                    ` +${money(option.priceDeltaCents)}`}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                        <Input
                          className="text-xs"
                          placeholder="Nota (sin cebolla, bien cocida…)"
                          value={line.notes}
                          onChange={(e) => updateLine(line.key, { notes: e.target.value })}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {quote.data && (
            <div className="mt-3 border-t border-slate-200 pt-3 text-sm">
              <div className="flex justify-between py-0.5">
                <span className="text-slate-500">Subtotal</span>
                <span>{money(quote.data.subtotalCents)}</span>
              </div>
              {quote.data.deliveryFeeCents > 0 && (
                <div className="flex justify-between py-0.5">
                  <span className="text-slate-500">Envío</span>
                  <span>{money(quote.data.deliveryFeeCents)}</span>
                </div>
              )}
              <div className="mt-1 flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
                <span>Total</span>
                <span>{money(quote.data.totalCents)}</span>
              </div>
            </div>
          )}
          {quote.error && <div className="mt-2"><ErrorMessage error={quote.error} /></div>}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Pago y observaciones</h2>
          <div className="space-y-3">
            <Field label="Método de pago">
              <Select
                value={paymentMethodId}
                onChange={(e) => setPaymentMethodId(e.target.value)}
              >
                <option value="">Sin definir</option>
                {paymentMethods?.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name}
                  </option>
                ))}
              </Select>
            </Field>

            {paymentMethods?.find((m) => m.id === paymentMethodId)?.requiresChangeFor && (
              <Field label="Paga con" hint="Para calcular el vuelto">
                <Input
                  inputMode="numeric"
                  placeholder="20000"
                  value={paidWith}
                  onChange={(e) => setPaidWith(e.target.value)}
                />
              </Field>
            )}

            <Field label="Observaciones">
              <Textarea
                rows={2}
                placeholder="Tocar timbre, no tiene cambio…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>
        </Card>

        {createOrder.error && <ErrorMessage error={createOrder.error} />}

        <Button size="lg" className="w-full" disabled={!canSubmit} onClick={submit}>
          {createOrder.isPending ? 'Guardando…' : 'Confirmar pedido'}
        </Button>
      </div>
    </div>
  );
}
