import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_TYPES,
  ORDER_TYPE_LABELS,
} from '@autoelite/shared';
import { useState } from 'react';
import { Badge, Card, Drawer, EmptyState, ErrorMessage, Input, Select, Spinner } from '@/components/ui';
import { OrderDetail } from '@/features/orders/OrderDetail';
import { STATUS_TONE, TYPE_ICON } from '@/features/orders/order-visuals';
import { useOrderHistory } from '@/features/orders/orders.api';
import { dateTime, money } from '@/lib/format';

export function HistoryPage() {
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const filters = Object.fromEntries(
    Object.entries({ status, type, search }).filter(([, value]) => Boolean(value)),
  ) as Record<string, string>;

  const { data, isLoading, error } = useOrderHistory(filters);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Historial</h1>
      </header>

      <Card className="flex flex-wrap gap-3 p-3">
        <Input
          className="w-56"
          placeholder="Buscar por cliente o teléfono"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          {ORDER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {ORDER_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
        <Select className="w-44" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Todas las modalidades</option>
          {ORDER_TYPES.map((value) => (
            <option key={value} value={value}>
              {ORDER_TYPE_LABELS[value]}
            </option>
          ))}
        </Select>
      </Card>

      {isLoading && <div className="flex justify-center py-16"><Spinner className="size-8" /></div>}
      {error && <ErrorMessage error={error} />}

      {data && data.data.length === 0 && (
        <EmptyState title="No hay pedidos" description="Probá cambiando los filtros." />
      )}

      {data && data.data.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">#</th>
                <th className="px-4 py-2.5">Fecha</th>
                <th className="px-4 py-2.5">Cliente</th>
                <th className="px-4 py-2.5">Modalidad</th>
                <th className="px-4 py-2.5">Estado</th>
                <th className="px-4 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.data.map((order) => (
                <tr
                  key={order.id}
                  onClick={() => setOpenOrderId(order.id)}
                  className="cursor-pointer transition hover:bg-slate-50"
                >
                  <td className="px-4 py-2.5 font-semibold tabular-nums">#{order.number}</td>
                  <td className="px-4 py-2.5 text-slate-500">{dateTime(order.placedAt)}</td>
                  <td className="px-4 py-2.5">{order.customerName}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {TYPE_ICON[order.type]} {ORDER_TYPE_LABELS[order.type]}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={STATUS_TONE[order.status]}>
                      {ORDER_STATUS_LABELS[order.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                    {money(order.totalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

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
