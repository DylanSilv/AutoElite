import { ORDER_TYPE_LABELS, type OrderType } from '@autoelite/shared';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, ErrorMessage, Select, Spinner } from '@/components/ui';
import { useDashboard } from '@/features/orders/orders.api';
import { money } from '@/lib/format';

/** Paleta acotada: los gráficos tienen que leerse como un sistema, no como un collage. */
const PALETTE = ['#f97316', '#0ea5e9', '#8b5cf6', '#10b981', '#f43f5e'];

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}

export function DashboardPage() {
  const [days, setDays] = useState('7');
  const range = days === '0' ? {} : { from: daysAgo(Number(days)), to: daysAgo(0) };
  const { data, isLoading, error } = useDashboard(range);

  if (isLoading) return <div className="flex justify-center py-20"><Spinner className="size-8" /></div>;
  if (error) return <ErrorMessage error={error} />;
  if (!data) return null;

  const salesByDay = data.salesByDay.map((row) => ({
    ...row,
    label: row.date.slice(5).split('-').reverse().join('/'),
    pesos: row.salesCents / 100,
  }));

  const byType = data.byType.map((row) => ({
    name: ORDER_TYPE_LABELS[row.type as OrderType],
    value: row.ordersCount,
  }));

  const byPayment = data.byPaymentMethod.map((row) => ({
    name: row.name,
    value: row.ordersCount,
  }));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
        <Select className="w-48" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="0">Hoy</option>
          <option value="7">Últimos 7 días</option>
          <option value="14">Últimos 14 días</option>
          <option value="30">Últimos 30 días</option>
        </Select>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ventas" value={money(data.salesCents)} hint="Sin contar cancelados" />
        <Stat label="Pedidos" value={String(data.ordersCount)} />
        <Stat label="Ticket promedio" value={money(data.averageTicketCents)} />
        <Stat label="Pedidos activos" value={String(data.activeOrdersCount)} hint="En curso ahora" />
      </div>

      {salesByDay.length > 1 && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Ventas por día</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis
                  tick={{ fontSize: 12 }}
                  stroke="#94a3b8"
                  tickFormatter={(value: number) => `$${Math.round(value / 1000)}k`}
                />
                <Tooltip
                  formatter={(value: number) => [money(value * 100), 'Ventas']}
                  labelFormatter={(label: string) => `Día ${label}`}
                />
                <Bar dataKey="pesos" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Productos más vendidos</h2>
          {data.topProducts.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">Sin datos en el período</p>
          ) : (
            <ul className="space-y-2">
              {data.topProducts.map((product, index) => (
                <li key={product.name} className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-xs text-slate-400">{index + 1}.</span>
                  <span className="flex-1 truncate">{product.name}</span>
                  <span className="tabular-nums text-slate-500">{product.quantity}</span>
                  <span className="w-24 text-right tabular-nums font-medium">
                    {money(product.salesCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Por modalidad</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byType} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
                  {byType.map((entry, index) => (
                    <Cell key={entry.name} fill={PALETTE[index % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Por método de pago</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byPayment} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
                  {byPayment.map((entry, index) => (
                    <Cell key={entry.name} fill={PALETTE[index % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
