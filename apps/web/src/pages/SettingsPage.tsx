import { WEEKDAY_LABELS, type CommerceDto } from '@autoelite/shared';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, ErrorMessage, Spinner } from '@/components/ui';
import { usePromotions, useTogglePromotion } from '@/features/agent/agent.api';
import { useDeliveryZones, usePaymentMethods } from '@/features/catalog/catalog.api';
import { api } from '@/lib/api-client';
import { money } from '@/lib/format';
import { useAuth } from '@/lib/auth';

export function SettingsPage() {
  const { user } = useAuth();
  const { data: commerce, isLoading, error } = useQuery({
    queryKey: ['commerce'],
    queryFn: () => api.get<CommerceDto>('/commerce'),
  });
  const { data: zones } = useDeliveryZones();
  const { data: paymentMethods } = usePaymentMethods();

  if (isLoading) return <div className="flex justify-center py-16"><Spinner className="size-8" /></div>;
  if (error) return <ErrorMessage error={error} />;
  if (!commerce) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Configuración</h1>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Comercio</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Nombre</dt>
              <dd className="font-medium">{commerce.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Teléfono</dt>
              <dd>{commerce.phone ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Dirección</dt>
              <dd className="text-right">{commerce.address ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Horario</dt>
              <dd className="text-right">{commerce.openingHours ?? '— sin cargar'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Zona horaria</dt>
              <dd>{commerce.timezone}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Cierre del día operativo</dt>
              <dd>{commerce.businessDayCutoff}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            El día operativo cierra a las {commerce.businessDayCutoff}: un pedido de las 00:40
            cuenta para el día anterior, igual que en la caja. El horario es lo que el asistente
            le contesta a quien pregunta si están abiertos.
          </p>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Tu sesión</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Usuario</dt>
              <dd className="font-medium">{user?.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Email</dt>
              <dd>{user?.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Rol</dt>
              <dd><Badge tone="violet">{user?.role}</Badge></dd>
            </div>
          </dl>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Zonas de envío</h2>
          <ul className="space-y-1.5 text-sm">
            {zones?.map((zone) => (
              <li key={zone.id} className="flex items-center justify-between">
                <span>{zone.name}</span>
                <span className="flex items-center gap-2">
                  {zone.estimatedMin && (
                    <span className="text-xs text-slate-400">~{zone.estimatedMin} min</span>
                  )}
                  <span className="font-medium tabular-nums">{money(zone.feeCents)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Métodos de pago</h2>
          <ul className="space-y-1.5 text-sm">
            {paymentMethods?.map((method) => (
              <li key={method.id} className="flex items-center justify-between">
                <span>{method.name}</span>
                <span className="flex items-center gap-1.5">
                  {method.requiresPrepayment && <Badge tone="amber">Se paga antes</Badge>}
                  {method.requiresChangeFor && <Badge>Calcula vuelto</Badge>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Los que se pagan antes frenan el pedido hasta que alguien verifique el comprobante.
          </p>
        </Card>

        <PromotionsCard />
      </div>
    </div>
  );
}

/**
 * Promociones.
 *
 * Es lo que el asistente le cuenta al cliente cuando pregunta por promos, así
 * que apagar una acá la saca de WhatsApp en el mismo momento.
 */
function PromotionsCard() {
  const { data, isLoading } = usePromotions(true);
  const toggle = useTogglePromotion();
  const promotions = data?.data ?? [];

  return (
    <Card className="p-4 lg:col-span-2">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Promociones</h2>

      {isLoading ? (
        <Spinner />
      ) : promotions.length === 0 ? (
        <p className="text-sm text-slate-500">Todavía no hay promociones cargadas.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {promotions.map((promotion) => (
            <li key={promotion.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  {promotion.title}
                  {promotion.isActive && promotion.activeToday && <Badge tone="emerald">Hoy</Badge>}
                  {!promotion.isActive && <Badge>Apagada</Badge>}
                </p>
                <p className="text-xs text-slate-500">{promotion.description}</p>
                {promotion.weekdays.length > 0 && (
                  <p className="mt-0.5 text-xs text-slate-400">
                    Sólo {promotion.weekdays.map((day) => WEEKDAY_LABELS[day]).join(', ')}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ id: promotion.id, isActive: !promotion.isActive })}
              >
                {promotion.isActive ? 'Apagar' : 'Encender'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-slate-500">
        El asistente sólo cuenta las promociones encendidas y vigentes hoy: nunca inventa una.
      </p>
    </Card>
  );
}
