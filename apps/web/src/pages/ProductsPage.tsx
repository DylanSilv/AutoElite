import { useState } from 'react';
import { Badge, Card, EmptyState, ErrorMessage, Input, Select, Spinner } from '@/components/ui';
import { useCategories, useProducts, useToggleAvailability } from '@/features/catalog/catalog.api';
import { money } from '@/lib/format';

export function ProductsPage() {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');

  const { data: categories } = useCategories();
  const { data: products, isLoading, error } = useProducts({ search, categoryId });
  const toggle = useToggleAvailability();

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Menú</h1>
          <p className="text-sm text-slate-500">
            Tocá un producto para cortarlo o reponerlo durante el servicio
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            className="w-48"
            placeholder="Buscar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select className="w-44" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Todas</option>
            {categories?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} ({category.productsCount ?? 0})
              </option>
            ))}
          </Select>
        </div>
      </header>

      {isLoading && <div className="flex justify-center py-16"><Spinner className="size-8" /></div>}
      {error && <ErrorMessage error={error} />}
      {products?.length === 0 && <EmptyState title="No hay productos con ese filtro" />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products?.map((product) => (
          <Card key={product.id} className="flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate font-medium text-slate-900">{product.name}</h2>
                <p className="text-xs text-slate-500">{product.category.name}</p>
              </div>
              <button
                type="button"
                disabled={toggle.isPending}
                onClick={() =>
                  toggle.mutate({ id: product.id, isAvailable: !product.isAvailable })
                }
                className={
                  product.isAvailable
                    ? 'rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200'
                    : 'rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 ring-1 ring-red-200'
                }
              >
                {product.isAvailable ? 'Disponible' : 'Sin stock'}
              </button>
            </div>

            {product.description && (
              <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{product.description}</p>
            )}

            <div className="mt-3 space-y-1">
              {product.variants.map((variant) => (
                <div key={variant.id} className="flex justify-between text-sm">
                  <span className={variant.isAvailable ? 'text-slate-700' : 'text-slate-400 line-through'}>
                    {variant.name}
                  </span>
                  <span className="font-medium tabular-nums">{money(variant.priceCents)}</span>
                </div>
              ))}
            </div>

            {product.modifierGroups.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {product.modifierGroups.map((group) => (
                  <Badge key={group.id}>{group.name}</Badge>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
