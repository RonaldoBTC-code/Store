import { Heading, Text } from "@modules/common/components/ui"
import TransferActions from "@modules/order/components/transfer-actions"
import TransferImage from "@modules/order/components/transfer-image"

export default async function TransferPage({
  params,
}: {
  params: { id: string; token: string }
}) {
  const { id, token } = params

  return (
    <div className="flex flex-col gap-y-4 items-start w-2/5 mx-auto mt-10 mb-20">
      <TransferImage />
      <div className="flex flex-col gap-y-6">
        <Heading level="h1" className="text-xl text-zinc-900">
          Transferencia del pedido {id}
        </Heading>
        <Text className="text-zinc-600">
          Te pidieron pasar la titularidad del pedido ({id}). Si estás de
          acuerdo, aprueba la transferencia con el botón de abajo.
        </Text>
        <div className="w-full h-px bg-zinc-200" />
        <Text className="text-zinc-600">
          Si aceptas, la otra persona queda a cargo de este pedido.
        </Text>
        <Text className="text-zinc-600">
          Si no reconoces la solicitud o quieres quedarte con el pedido, no
          hagas nada.
        </Text>
        <div className="w-full h-px bg-zinc-200" />
        <TransferActions id={id} token={token} />
      </div>
    </div>
  )
}
