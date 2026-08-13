import {
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  type OrderStatus,
  type OrderSummaryDto,
} from '@autoelite/shared';
import clsx from 'clsx';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Drawer, ErrorMessage, Spinner } from '@/components/ui';
import { OrderDetail } from '@/features/orders/OrderDetail';
import { STATUS_ACCENT, TRANSITION_LABEL, TYPE_ICON, urgencyClass } from '@/features/orders/order-visuals';
import { useBoard, useChangeStatus } from '@/features/orders/orders.api';
import { elapsedLabel, minutesSince, money, time } from '@/lib/format';

/** Siguiente estado natural, para que avanzar sea un solo toque en la tarjeta. */
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  PENDIENTE: 'CONFIRMADO',
  CONFIRMADO: 'EN_PREPARACION',
  EN_PREPARACION: 'LISTO',
};

function nextStatusFor(order: OrderSummaryDto): OrderStatus | null {
  if (order.status === 'LISTO') return order.type === 'DELIVERY' ? 'EN_CAMINO' : 'ENTREGADO';
  if (order.status === 'EN_CAMINO') return 'ENTREGADO';
  return NEXT_STATUS[order.status] ?? null;
}

function OrderCard({
  order,
  onOpen,
}: {
  order: OrderSummaryDto;
  onOpen: (id: string) => void;
}) {
  const changeStatus = useChangeStatus();
  const next = nextStatusFor(order);
  const minutes = minutesSince(order.placedAt);

  return (
    <article
      className={clsx(
        'rounded-lg border-l-4 bg-white p-3 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md',
        STATUS_ACCENT[order.status],
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(order.id)}
        className="block w-full text-left"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-lg font-bold tabular-nums text-slate-900">#{order.number}</span>
          <span className={clsx('text-xs tabular-nums', urgencyClass(minutes, order.status))}>
            {elapsedLabel(order.placedAt)}
          </span>
        </div>

        <p className="mt-1 truncate text-sm font-medium text-slate-800">{order.customerName}</p>

        <div className="mt-1.5 flex items-center justify-between gap-2">
          {/* Truncar en vez de envolver: si la línea salta, las tarjetas quedan
              de alturas distintas y la columna se lee peor de lejos. */}
          <span className="min-w-0 truncate text-xs text-slate-500">
            {TYPE_ICON[order.type]} {ORDER_TYPE_LABELS[order.type]} · {order.itemsCount} ít.
          </span>
          <span className="shrink-0 text-sm font-semibold text-slate-900">
            {money(order.totalCents)}
          </span>
        </div>

        <p className="mt-0.5 text-xs text-slate-400">Ingresó {time(order.placedAt)}</p>
      </button>

      {next && (
        <Button
          size="sm"
          variant={next === 'ENTREGADO' ? 'success' : 'primary'}
          className="mt-2.5 w-full"
          disabled={changeStatus.isPending}
          onClick={() => changeStatus.mutate({ id: order.id, from: order.status, to: next })}
        >
          {TRANSITION_LABEL[next]}
        </Button>
      )}
    </article>
  );
}

export function BoardPage() {
  const { data, isLoading, error, isFetching } = useBoard();
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="size-8" />
      </div>
    );
  }
  if (error) return <ErrorMessage error={error} />;
  if (!data) return null;

  const totalActive = data.columns.reduce((sum, column) => sum + column.orders.length, 0);

  return (
    <div className="flex h-full flex-col">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Pedidos de hoy</h1>
          <p className="text-sm text-slate-500">
            {totalActive} {totalActive === 1 ? 'pedido activo' : 'pedidos activos'}
            <span className="text-slate-400"> · {data.deliveredCount} entregados</span>
            {isFetching && <span className="ml-2 text-xs text-slate-400">actualizando…</span>}
          </p>
        </div>
        <Link to="/pedidos/nuevo">
          <Button size="lg">+ Nuevo pedido</Button>
        </Link>
      </header>

      <div className="board-scroll -mx-1 flex min-h-0 flex-1 gap-3 overflow-x-auto px-1 pb-2">
        {data.columns.map((column) => (
          <section
            key={column.status}
            className="flex min-w-[220px] flex-1 flex-col rounded-xl bg-slate-200/60 p-2"
          >
            <header className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-slate-700">
                {ORDER_STATUS_LABELS[column.status]}
              </h2>
              <Badge>{column.orders.length}</Badge>
            </header>

            <div className="board-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              {column.orders.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-slate-400">Sin pedidos</p>
              ) : (
                column.orders.map((order) => (
                  <OrderCard key={order.id} order={order} onOpen={setOpenOrderId} />
                ))
              )}
            </div>
          </section>
        ))}
      </div>

      <Drawer
        open={Boolean(openOrderId)}
        onClose={() => setOpenOrderId(null)}
        title={<h2 className="text-lg font-semibold text-slate-900">Detalle del pedido</h2>}
      >
        {openOrderId && <OrderDetail orderId={openOrderId} />}
      </Drawer>
    </div>
  );
}
