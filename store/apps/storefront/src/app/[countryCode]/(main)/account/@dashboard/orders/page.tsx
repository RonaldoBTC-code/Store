import { Metadata } from "next"

import OrderOverview from "@modules/account/components/order-overview"
import { notFound } from "next/navigation"
import { listOrders } from "@lib/data/orders"
import Divider from "@modules/common/components/divider"
import TransferRequestForm from "@modules/account/components/transfer-request-form"

export const metadata: Metadata = {
  title: "Pedidos | Gato Gang",
  description: "Revisa tus pedidos anteriores de Gato Gang.",
}

export default async function Orders() {
  const orders = await listOrders()

  if (!orders) {
    notFound()
  }

  return (
    <div className="w-full" data-testid="orders-page-wrapper">
      <div className="mb-8 flex flex-col gap-y-4">
        <h1 className="text-2xl-semi">Pedidos</h1>
        <p className="text-base-regular">
          Revisa tus pedidos anteriores y su estado. Si necesitas un cambio,
          escríbenos.
        </p>
      </div>
      <div>
        <OrderOverview orders={orders} />
        <Divider className="mb-8 mt-8" />
        <TransferRequestForm />
      </div>
    </div>
  )
}
