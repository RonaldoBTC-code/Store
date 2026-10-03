"use client"

import { completePayphoneReturn } from "@lib/data/payphone"
import type { PayphoneReturnResult } from "@lib/data/payphone"
import {
  payphoneReturnView,
  type PayphoneReturnView,
} from "@lib/payphone-return"
import { PayphoneReturnCopy } from "./status"
import { useEffect, useState } from "react"

const INITIAL_DELAY_MS = 2_000
const MAX_DELAY_MS = 30_000

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
  const [phase, setPhase] = useState<PayphoneReturnView>(() =>
    payphoneReturnView(initial, 0)
  )

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

      const next = payphoneReturnView(result, Date.now() - started)
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

  return <PayphoneReturnCopy view={phase} />
}
