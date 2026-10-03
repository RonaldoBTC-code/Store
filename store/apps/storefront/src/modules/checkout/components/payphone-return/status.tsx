import {
  PAYPHONE_CONFIRMING_COPY,
  PAYPHONE_NO_CHARGE_COPY,
  PAYPHONE_PENDING_NOTICE,
  PAYPHONE_REVERSED_COPY,
  payphoneReturnView,
  type PayphoneReturnSnapshot,
  type PayphoneReturnView,
} from "../../../../lib/payphone-return"

export function PayphoneReturnStatus({
  result,
  elapsedMs = 0,
}: {
  result: PayphoneReturnSnapshot | null
  elapsedMs?: number
}) {
  return <PayphoneReturnCopy view={payphoneReturnView(result, elapsedMs)} />
}

export function PayphoneReturnCopy({ view }: { view: PayphoneReturnView }) {
  const copy =
    view === "reversed"
      ? PAYPHONE_REVERSED_COPY
      : view === "rejected"
        ? PAYPHONE_NO_CHARGE_COPY
        : view === "pending"
          ? PAYPHONE_PENDING_NOTICE
          : PAYPHONE_CONFIRMING_COPY

  return (
    <div className="content-container py-16">
      {/* TODO(contacto): hace falta un contacto de soporte para el pago que sigue pendiente y para needs_reversal después de las 20:00, hora de Ecuador. Reverse no funciona pasado ese horario. */}
      <p className="text-xl" role="status" data-testid="payphone-return-status">
        {copy}
      </p>
    </div>
  )
}
