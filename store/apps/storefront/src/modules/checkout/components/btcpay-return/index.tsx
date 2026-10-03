"use client"

import { getBtcpayPaymentState, BtcpayPaymentState } from "@lib/data/btcpay"
import { placeOrder } from "@lib/data/cart"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"

const PENDING_TITLE = "Pago pendiente de confirmación"
const CREATING_ORDER = "Pago recibido. Estamos creando tu pedido…"
const PARTIAL_COPY =
  "Recibimos un pago menor al total, así que no creamos tu pedido. No vuelvas a pagar esta factura. Escríbenos para devolverte lo que enviaste."
const PAID_LATE_COPY =
  "Recibimos el pago después del plazo. No creamos tu pedido de forma automática. El siguiente paso es una revisión."
const PAID_OVER_COPY =
  "Recibimos un pago mayor que el total. No creamos tu pedido de forma automática. El siguiente paso es una revisión."
const CONTACT_TODO = "TODO(contacto)"

type Screen =
  | { kind: "waiting" }
  | { kind: "creating" }
  | { kind: "notice"; text: string }
  | { kind: "error"; text: string; action: "retry" | "checkout" | "store" }

function screenFor(state: BtcpayPaymentState["state"]): Screen {
  switch (state) {
    case "pending":
    case "processing":
    case "limit_reached":
      return { kind: "waiting" }
    case "settled":
      return { kind: "creating" }
    case "partial":
      return { kind: "notice", text: PARTIAL_COPY }
    case "paid_late":
      return { kind: "notice", text: PAID_LATE_COPY }
    case "paid_over":
      return { kind: "notice", text: PAID_OVER_COPY }
    case "expired":
      return {
        kind: "error",
        text: "El plazo de este pago venció.",
        action: "retry",
      }
    case "invalid":
      return {
        kind: "error",
        text: "Este pago quedó anulado.",
        action: "retry",
      }
    case "cart_changed":
      return {
        kind: "error",
        text: "El total del carrito cambió.",
        action: "checkout",
      }
    case "mismatch":
      return {
        kind: "error",
        text: "Este pago no corresponde a este carrito.",
        action: "checkout",
      }
    case "failed":
      return {
        kind: "error",
        text: "No encontramos el pago.",
        action: "store",
      }
  }
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest.startsWith("NEXT_REDIRECT")
  )
}

export default function BtcpayReturn({ cartId }: { cartId: string }) {
  const router = useRouter()
  const { countryCode } = useParams()
  const [screen, setScreen] = useState<Screen>({ kind: "waiting" })
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const refreshRef = useRef<() => void>(() => undefined)
  const onElapsed = useCallback(() => {
    refreshRef.current()
  }, [])

  useEffect(() => {
    let stopped = false
    let confirming = false

    const tick = async () => {
      try {
        const status = await getBtcpayPaymentState(cartId)
        if (stopped) {
          return
        }

        if (status.state === "settled" && status.order_id) {
          router.replace(`/${countryCode}/order/${status.order_id}/confirmed`)
          return
        }

        if (status.state === "settled") {
          setScreen({ kind: "creating" })
          setExpiresAt(null)
          if (confirming) {
            return
          }
          confirming = true
          try {
            await placeOrder(cartId)
          } catch (error) {
            confirming = false
            if (isNextRedirect(error)) {
              throw error
            }
          }
          return
        }

        const next = screenFor(status.state)
        setScreen(next)
        setExpiresAt(next.kind === "waiting" ? status.expires_at ?? null : null)
      } catch (error) {
        if (isNextRedirect(error)) {
          throw error
        }
        if (!stopped) {
          setScreen({ kind: "waiting" })
        }
      }
    }

    refreshRef.current = () => {
      void tick()
    }
    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, 4000)

    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [cartId, countryCode, router])

  const testId =
    screen.kind === "waiting"
      ? "btcpay-pending-confirmation"
      : screen.kind === "creating"
        ? "btcpay-creating-order"
        : screen.kind === "notice"
          ? "btcpay-payment-notice"
          : "btcpay-payment-error"
  const title =
    screen.kind === "waiting"
      ? PENDING_TITLE
      : screen.kind === "creating"
        ? CREATING_ORDER
        : "Pago con Bitcoin"
  const body = screen.kind === "notice" || screen.kind === "error" ? screen.text : ""

  return (
    <div className="content-container py-16" data-testid="btcpay-return-status">
      <h1
        className="text-2xl-regular mb-4"
        data-testid={screen.kind === "waiting" || screen.kind === "creating" ? testId : undefined}
      >
        {title}
      </h1>
      {body ? (
        <p className="txt-medium text-white/80" data-testid={testId}>
          {body}
        </p>
      ) : null}
      <StatusAction screen={screen} />
      {expiresAt && screen.kind === "waiting" ? (
        <ReservationCountdown expiresAt={expiresAt} onElapsed={onElapsed} />
      ) : null}
    </div>
  )
}

function StatusAction({ screen }: { screen: Screen }) {
  if (screen.kind === "notice") {
    return (
      <p className="txt-medium mt-4 text-white/80" data-testid="btcpay-status-action">
        {CONTACT_TODO}
      </p>
    )
  }
  if (screen.kind !== "error") {
    return null
  }
  if (screen.action === "retry") {
    return (
      <LocalizedClientLink
        href="/checkout?step=payment"
        className="txt-medium mt-4 inline-block underline"
        data-testid="btcpay-status-action"
      >
        Intentar de nuevo
      </LocalizedClientLink>
    )
  }
  if (screen.action === "checkout") {
    return (
      <LocalizedClientLink
        href="/checkout"
        className="txt-medium mt-4 inline-block underline"
        data-testid="btcpay-status-action"
      >
        Volver al checkout
      </LocalizedClientLink>
    )
  }
  return (
    <LocalizedClientLink
      href="/"
      className="txt-medium mt-4 inline-block underline"
      data-testid="btcpay-status-action"
    >
      Ir a la tienda
    </LocalizedClientLink>
  )
}

function ReservationCountdown({
  expiresAt,
  onElapsed,
}: {
  expiresAt: string
  onElapsed: () => void
}) {
  const [clock, setClock] = useState("")
  const [live, setLive] = useState("")
  const [verifying, setVerifying] = useState(false)
  const onElapsedRef = useRef(onElapsed)
  onElapsedRef.current = onElapsed

  useEffect(() => {
    let previous: number | null = null
    let announcedExpired = false

    const tick = () => {
      const expiry = new Date(expiresAt).getTime()
      const remaining = expiry - Date.now()
      if (!Number.isFinite(remaining)) {
        setClock("")
        return
      }
      if (remaining <= 0) {
        setVerifying(true)
        setClock("")
        if (!announcedExpired) {
          announcedExpired = true
          setLive("Verificando…")
          onElapsedRef.current()
        }
        return
      }
      setVerifying(false)
      const when = new Date(expiresAt)
      const hours = String(when.getHours()).padStart(2, "0")
      const minutes = String(when.getMinutes()).padStart(2, "0")
      setClock(`Vence a las ${hours}:${minutes}`)
      if (previous == null) {
        previous = remaining
        return
      }
      if (previous > 5 * 60 * 1000 && remaining <= 5 * 60 * 1000) {
        setLive("Quedan 5 minutos.")
      } else if (previous > 60 * 1000 && remaining <= 60 * 1000) {
        setLive("Queda 1 minuto.")
      }
      previous = remaining
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt])

  return (
    <>
      <p className="txt-medium mt-4" data-testid="btcpay-reservation-countdown">
        {verifying ? "Verificando…" : clock}
      </p>
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
    </>
  )
}
