import { HttpTypes } from "@medusajs/types"
import { Text } from "@modules/common/components/ui"

type OrderDetailsProps = {
  order: HttpTypes.StoreOrder
  showStatus?: boolean
}

const STATUS_LABELS: Record<string, string> = {
  not_fulfilled: "Sin enviar",
  partially_fulfilled: "Enviado en parte",
  fulfilled: "Preparado",
  partially_shipped: "En camino en parte",
  shipped: "En camino",
  partially_delivered: "Entrega parcial",
  delivered: "Entregado",
  canceled: "Cancelado",
  cancelled: "Cancelado",
  not_paid: "Sin pagar",
  awaiting: "Pendiente",
  authorized: "Autorizado",
  captured: "Pagado",
  partially_captured: "Pago parcial",
  partially_refunded: "Reembolso parcial",
  refunded: "Reembolsado",
  requires_action: "Requiere acción",
  pending: "Pendiente",
  completed: "Completado",
}

const OrderDetails = ({ order, showStatus }: OrderDetailsProps) => {
  const formatStatus = (str: string) => {
    return STATUS_LABELS[str] ?? str.split("_").join(" ")
  }

  return (
    <div>
      <Text>
        Te mandamos la confirmación a{" "}
        <span
          className="text-ui-fg-medium-plus font-semibold"
          data-testid="order-email"
        >
          {order.email}
        </span>
        .
      </Text>
      <Text className="mt-2">
        Fecha:{" "}
        <span data-testid="order-date">
          {new Date(order.created_at).toLocaleDateString("es-EC", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </span>
      </Text>
      <Text className="mt-2 text-ui-fg-interactive">
        Número de pedido: <span data-testid="order-id">{order.display_id}</span>
      </Text>

      <div className="flex items-center text-compact-small gap-x-4 mt-4">
        {showStatus && (
          <>
            <Text>
              Estado del pedido:{" "}
              <span className="text-ui-fg-subtle " data-testid="order-status">
                {formatStatus(order.fulfillment_status)}
              </span>
            </Text>
            <Text>
              Estado del pago:{" "}
              <span
                className="text-ui-fg-subtle "
                data-testid="order-payment-status"
              >
                {formatStatus(order.payment_status)}
              </span>
            </Text>
          </>
        )}
      </div>
    </div>
  )
}

export default OrderDetails
