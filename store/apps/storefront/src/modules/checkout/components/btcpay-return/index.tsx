"use client"

import { getBtcpayPaymentState } from "@lib/data/btcpay"
import { placeOrder } from "@lib/data/cart"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

const PENDING_MESSAGE = "pago pendiente de confirmación"

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
  const [message, setMessage] = useState(PENDING_MESSAGE)
  const [failed, setFailed] = useState(false)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)

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
          if (confirming) {
            return
          }
          confirming = true
          setMessage(PENDING_MESSAGE)
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

        if (status.state === "pending" || status.state === "processing") {
          setFailed(false)
          setExpiresAt(status.expires_at ?? null)
          setMessage(PENDING_MESSAGE)
          return
        }

        setFailed(true)
        setMessage(status.message)
      } catch (error) {
        if (isNextRedirect(error)) {
          throw error
        }
        if (!stopped) {
          setMessage(PENDING_MESSAGE)
        }
      }
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

  return (
    <div className="content-container py-16" data-testid="btcpay-return-status">
      <h1 className="text-2xl-regular mb-4">Pago con Bitcoin</h1>
      <p
        className="txt-medium text-white/80"
        data-testid={failed ? "btcpay-payment-error" : "btcpay-pending-confirmation"}
      >
        {message}
      </p>
      {expiresAt && !failed ? <ReservationCountdown expiresAt={expiresAt} /> : null}
    </div>
  )
}

function ReservationCountdown({ expiresAt }: { expiresAt: string }) {
  const [label, setLabel] = useState("")

  useEffect(() => {
    const tick = () => {
      const remaining = new Date(expiresAt).getTime() - Date.now()
      if (!Number.isFinite(remaining)) {
        setLabel("")
        return
      }
      const seconds = Math.max(0, Math.floor(remaining / 1000))
      const minutes = Math.floor(seconds / 60)
      const rest = seconds % 60
      setLabel(
        `La reserva vence en ${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
      )
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt])

  if (!label) {
    return null
  }

  return (
    <p className="txt-medium mt-4" data-testid="btcpay-reservation-countdown">
      {label}
    </p>
  )
}
