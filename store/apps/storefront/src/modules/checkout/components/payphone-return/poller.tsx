"use client"

import { completePayphoneReturn } from "@lib/data/payphone"
import type { PayphoneReturnResult } from "@lib/data/payphone"
import {
  PAYPHONE_CONFIRMING_COPY,
  PAYPHONE_NO_CHARGE_COPY,
  PAYPHONE_PENDING_NOTICE,
  PAYPHONE_REVERSED_COPY,
} from "@lib/payphone-return"
import { useEffect, useState } from "react"

const CONFIRMING_MS = 30_000
const INITIAL_DELAY_MS = 2_000
const MAX_DELAY_MS = 30_000

type Phase = "confirming" | "pending" | "reversed" | "rejected"

export function PayphoneReturnPoller({
  country,
  payphoneId,
  clientTransactionId,
  initial,
}: {
  country: string
  payphoneId: string
  clientTransactionId: string
  initial: PayphoneReturnResult | null
}) {
  const [phase, setPhase] = useState<Phase>(() => phaseFrom(initial, 0))

  useEffect(() => {
    const started = Date.now()
    let cancelled = false
    let delay = INITIAL_DELAY_MS
    let timer = 0

    const apply = (result: PayphoneReturnResult | null) => {
      if (result?.order_id && /^order_[A-Za-z0-9]+$/.test(result.order_id)) {
        const orderCountry = /^[a-z]{2}$/i.test(result.country_code || "")
          ? (result.country_code || country).toLowerCase()
          : country
        window.location.assign(`/${orderCountry}/order/${result.order_id}/confirmed`)
        return true
      }

      if (result?.code === "document") {
        window.location.assign(
          `/${country}/checkout?step=address&payphone=document`
        )
        return true
      }

      if (result?.code === "cart_changed") {
        window.location.assign(
          `/${country}/checkout?step=payment&payphone=cart_changed`
        )
        return true
      }

      const next = phaseFrom(result, Date.now() - started)
      setPhase(next)
      return next === "reversed" || next === "rejected"
    }

    if (apply(initial)) {
      return
    }

    const tick = async () => {
      const result = await completePayphoneReturn({
        id: payphoneId,
        clientTransactionId,
      })
      if (cancelled) {
        return
      }

      if (apply(result)) {
        return
      }

      timer = window.setTimeout(() => {
        void tick()
      }, delay)
      delay = Math.min(delay * 2, MAX_DELAY_MS)
    }

    timer = window.setTimeout(() => {
      void tick()
    }, delay)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [clientTransactionId, country, initial, payphoneId])

  const copy =
    phase === "reversed"
      ? PAYPHONE_REVERSED_COPY
      : phase === "rejected"
        ? PAYPHONE_NO_CHARGE_COPY
        : phase === "pending"
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

function phaseFrom(
  result: PayphoneReturnResult | null,
  elapsedMs: number
): Phase {
  if (result?.charge === "reversal_confirmed") {
    return "reversed"
  }

  if (result?.charge === "none" || result?.state === "no_charge") {
    return "rejected"
  }

  if (elapsedMs >= CONFIRMING_MS) {
    return "pending"
  }

  return "confirming"
}
