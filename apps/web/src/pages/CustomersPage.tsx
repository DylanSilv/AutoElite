import { useState } from 'react';
import { Card, EmptyState, ErrorMessage, Input, Spinner } from '@/components/ui';
import { useCustomers } from '@/features/catalog/catalog.api';
import { date, money } from '@/lib/format';

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useCustomers({ search });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Clientes</h1>
        <Input
          className="w-64"
          placeholder="Buscar por nombre o teléfono"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </header>

      {isLoading && <div className="flex justify-center py-16"><Spinner className="size-8" /></div>}
      {error && <ErrorMessage error={error} />}
      {data?.data.length === 0 && (
        <EmptyState
          title="Todavía no hay clientes"
          description="Se van creando solos a medida que se cargan pedidos con teléfono."
        />
      )}

      {data && data.data.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Cliente</th>
                <th className="px-4 py-2.5">Teléfono</th>
                <th className="px-4 py-2.5">Dirección</th>
                <th className="px-4 py-2.5 text-right">Pedidos</th>
                <th className="px-4 py-2.5 text-right">Total gastado</th>
                <th className="px-4 py-2.5">Último</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.data.map((customer) => {
                const address = customer.addresses.find((a) => a.isDefault) ?? customer.addresses[0];
                return (
                  <tr key={customer.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-900">{customer.name}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">{customer.phone}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {address ? `${address.street} ${address.number ?? ''}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{customer.ordersCount}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {money(customer.totalSpentCents)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {customer.lastOrderAt ? date(customer.lastOrderAt) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
