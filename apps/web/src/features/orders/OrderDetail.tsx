import {
  MESSAGE_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  type MessageStatus,
  type OrderStatus,
  type PaymentStatus,
} from '@autoelite/shared';
import { useState } from 'react';
import { Badge, Button, Card, ErrorMessage, Input, Spinner } from '@/components/ui';
import { dateTime, money, time } from '@/lib/format';
import {
  useCancelOrder,
  useChangeStatus,
  useConfirmPayment,
  useOrder,
  useRejectPayment,
} from './orders.api';
import { STATUS_TONE, TRANSITION_LABEL, TYPE_ICON } from './order-visuals';

const PAYMENT_TONE: Record<PaymentStatus, 'slate' | 'emerald' | 'red' | 'amber' | 'blue'> = {
  NOT_REQUIRED: 'slate',
  PENDING: 'amber',
  PROOF_SUBMITTED: 'blue',
  CONFIRMED: 'emerald',
  REJECTED: 'red',
};

/** El estado del aviso se lee de un vistazo: verde llegó, ámbar no salió. */
const NOTIFICATION_TONE: Record<MessageStatus, 'slate' | 'emerald' | 'red' | 'amber'> = {
  PENDING: 'slate',
  SENT: 'emerald',
  FAILED: 'red',
  SKIPPED: 'amber',
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value}</span>
    </div>
  );
}

export function OrderDetail({ orderId }: { orderId: string }) {
  const { data: order, isLoading, error } = useOrder(orderId);
  const changeStatus = useChangeStatus();
  const cancelOrder = useCancelOrder();
  const confirmPayment = useConfirmPayment();
  const rejectPayment = useRejectPayment();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (error) return <ErrorMessage error={error} />;
  if (!order) return null;

  const advance = (to: OrderStatus) => {
    // Se manda el estado del que se parte: si otro operador se adelantó, el
    // backend responde 409 y la pantalla se refresca en vez de pisar el cambio.
    changeStatus.mutate({ id: order.id, from: order.status, to });
  };

  return (
    <div className="space-y-4">
      {(changeStatus.error || cancelOrder.error || confirmPayment.error || rejectPayment.error) && (
        <ErrorMessage
          error={
            changeStatus.error ?? cancelOrder.error ?? confirmPayment.error ?? rejectPayment.error
          }
        />
      )}

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
          <Badge>{TYPE_ICON[order.type]} {ORDER_TYPE_LABELS[order.type]}</Badge>
          {order.source !== 'PANEL' && <Badge tone="violet">{order.source}</Badge>}
          {order.isPaid && <Badge tone="emerald">Pagado</Badge>}
        </div>

        <Row label="Cliente" value={order.customerName} />
        {order.customerPhone && <Row label="Teléfono" value={order.customerPhone} />}
        <Row label="Ingresó" value={dateTime(order.placedAt)} />
        {order.paymentMethodName && <Row label="Pago" value={order.paymentMethodName} />}
        {order.paidWithCents != null && (
          <Row
            label="Vuelto"
            value={money(Math.max(0, order.paidWithCents - order.totalCents))}
          />
        )}
      </Card>

      {order.address && (
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Entrega</h3>
          <p className="text-sm text-slate-700">
            {order.address.street} {order.address.number}
            {order.address.apartment ? `, ${order.address.apartment}` : ''}
          </p>
          {order.address.neighborhood && (
            <p className="text-sm text-slate-500">{order.address.neighborhood}</p>
          )}
          {order.address.reference && (
            <p className="mt-1 text-sm text-slate-600 italic">{order.address.reference}</p>
          )}
          {order.address.zoneName && (
            <p className="mt-2 text-xs text-slate-500">Zona: {order.address.zoneName}</p>
          )}
        </Card>
      )}

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Pedido</h3>
        <ul className="divide-y divide-slate-100">
          {order.items.map((item) => (
            <li key={item.id} className="py-2">
              <div className="flex justify-between gap-3">
                <span className="text-sm">
                  <span className="font-medium">{item.quantity}×</span> {item.productName}
                  <span className="text-slate-500"> · {item.variantName}</span>
                </span>
                <span className="whitespace-nowrap text-sm font-medium">
                  {money(item.lineTotalCents)}
                </span>
              </div>
              {item.modifiers.length > 0 && (
                <p className="mt-0.5 text-xs text-slate-500">
                  + {item.modifiers.map((m) => m.name).join(', ')}
                </p>
              )}
              {item.notes && <p className="mt-0.5 text-xs text-amber-700">Nota: {item.notes}</p>}
            </li>
          ))}
        </ul>

        <div className="mt-3 border-t border-slate-200 pt-3">
          <Row label="Subtotal" value={money(order.subtotalCents)} />
          {order.deliveryFeeCents > 0 && <Row label="Envío" value={money(order.deliveryFeeCents)} />}
          {order.discountCents > 0 && (
            <Row label="Descuento" value={`− ${money(order.discountCents)}`} />
          )}
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-2 text-base font-semibold">
            <span>Total</span>
            <span>{money(order.totalCents)}</span>
          </div>
        </div>
      </Card>

      {order.notes && (
        <Card className="p-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Observaciones</h3>
          <p className="text-sm text-slate-700">{order.notes}</p>
        </Card>
      )}

      {order.cancelReason && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          <strong>Cancelado:</strong> {order.cancelReason}
        </div>
      )}

      {order.allowedTransitions.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Acciones</h3>
          <div className="flex flex-wrap gap-2">
            {order.allowedTransitions
              .filter((status) => status !== 'CANCELADO')
              .map((status) => (
                <Button
                  key={status}
                  onClick={() => advance(status)}
                  disabled={changeStatus.isPending}
                  variant={status === 'ENTREGADO' ? 'success' : 'primary'}
                >
                  {TRANSITION_LABEL[status]}
                </Button>
              ))}
            {order.allowedTransitions.includes('CANCELADO') && !cancelling && (
              <Button variant="secondary" onClick={() => setCancelling(true)}>
                Cancelar pedido
              </Button>
            )}
          </div>

          {cancelling && (
            <div className="mt-3 space-y-2">
              <Input
                autoFocus
                placeholder="Motivo de la cancelación"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  disabled={!reason.trim() || cancelOrder.isPending}
                  onClick={() => cancelOrder.mutate({ id: order.id, reason: reason.trim() })}
                >
                  Confirmar cancelación
                </Button>
                <Button variant="ghost" onClick={() => setCancelling(false)}>
                  Volver
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {order.paymentStatus !== 'NOT_REQUIRED' && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Cobro</h3>
            <Badge tone={PAYMENT_TONE[order.paymentStatus]}>
              {PAYMENT_STATUS_LABELS[order.paymentStatus]}
            </Badge>
          </div>

          {order.paymentNote && <p className="mb-2 text-sm text-slate-600">{order.paymentNote}</p>}

          {order.paymentProofs.length === 0 ? (
            <p className="text-sm text-slate-500">El cliente todavía no mandó el comprobante.</p>
          ) : (
            <ul className="space-y-2">
              {order.paymentProofs.map((proof) => (
                <li key={proof.id} className="rounded-lg bg-slate-50 p-2">
                  {proof.mediaUrl ? (
                    <a href={proof.mediaUrl} target="_blank" rel="noreferrer">
                      <img
                        src={proof.mediaUrl}
                        alt="Comprobante enviado por el cliente"
                        className="max-h-56 w-auto rounded ring-1 ring-slate-200"
                      />
                    </a>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Comprobante recibido por WhatsApp (imagen pendiente de descarga)
                    </p>
                  )}
                  {proof.note && <p className="mt-1 text-xs text-slate-600">{proof.note}</p>}
                  <p className="mt-1 text-xs text-slate-400">{time(proof.submittedAt)}</p>
                </li>
              ))}
            </ul>
          )}

          {order.paymentStatus !== 'CONFIRMED' && (
            <>
              {/* Una captura se falsifica en minutos: quien confirma tiene que
                  haber mirado la cuenta, no sólo la imagen. */}
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
                Verificá el ingreso en la cuenta antes de confirmar. Una captura no es prueba de pago.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="success"
                  disabled={confirmPayment.isPending}
                  onClick={() => confirmPayment.mutate({ id: order.id })}
                >
                  Confirmar pago
                </Button>
                {!rejecting && (
                  <Button variant="secondary" onClick={() => setRejecting(true)}>
                    Rechazar
                  </Button>
                )}
              </div>

              {rejecting && (
                <div className="mt-3 space-y-2">
                  <Input
                    autoFocus
                    placeholder="Por qué no se pudo verificar"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="danger"
                      disabled={!rejectNote.trim() || rejectPayment.isPending}
                      onClick={() =>
                        rejectPayment.mutate({ id: order.id, note: rejectNote.trim() })
                      }
                    >
                      Rechazar pago
                    </Button>
                    <Button variant="ghost" onClick={() => setRejecting(false)}>
                      Volver
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {order.notifications.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Avisos al cliente</h3>
          <ul className="space-y-2">
            {order.notifications.map((notification, index) => (
              <li key={index} className="rounded-lg bg-slate-50 p-2.5">
                <div className="mb-1 flex items-center gap-2">
                  <Badge tone={NOTIFICATION_TONE[notification.status]}>
                    {MESSAGE_STATUS_LABELS[notification.status]}
                  </Badge>
                  <span className="text-xs text-slate-400">
                    {time(notification.sentAt ?? notification.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-line text-xs text-slate-600">{notification.body}</p>
                {notification.skipReason && (
                  // Si el aviso no salió, alguien va a tener que llamar: el
                  // motivo tiene que estar a la vista, no escondido en un log.
                  <p className="mt-1 text-xs text-amber-700">{notification.skipReason}</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Historial</h3>
        <ol className="space-y-1.5">
          {order.statusHistory.map((entry, index) => (
            <li key={index} className="flex items-center gap-2 text-sm">
              <span className="text-xs tabular-nums text-slate-400">{time(entry.createdAt)}</span>
              <Badge tone={STATUS_TONE[entry.toStatus]}>
                {ORDER_STATUS_LABELS[entry.toStatus]}
              </Badge>
              {entry.note && <span className="text-xs text-slate-500">{entry.note}</span>}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
