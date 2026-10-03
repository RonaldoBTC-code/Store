import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { PayphoneReturnStatus } from "../../../../../storefront/src/modules/checkout/components/payphone-return/status"
import {
  PAYPHONE_NO_CHARGE_COPY,
  PAYPHONE_PENDING_NOTICE,
  PAYPHONE_RETRY_LABEL,
} from "../../../../../storefront/src/lib/payphone-return"
import {
  PAYPHONE_PENDING_NOTICE as API_PENDING_NOTICE,
  shopperOutcomeMessage,
  shopperReturnState,
} from "../return-state"

const NOTICE = PAYPHONE_PENDING_NOTICE

function markup(result: { code: string; charge: string; state: string }) {
  return renderToStaticMarkup(
    createElement(PayphoneReturnStatus, { result, elapsedMs: 0 })
  )
}

describe("PayPhone return status", () => {
  it("shows the confirming notice when a network or timeout leaves the claim processing", () => {
    expect(shopperReturnState("open")).toBe("confirming")
    expect(shopperOutcomeMessage("pending", "open")).toBe(API_PENDING_NOTICE)

    for (const code of ["pending", "failed"]) {
      const html = markup({
        state: "confirming",
        code,
        charge: "open",
      })

      expect(html).toContain(NOTICE)
      expect(html).toContain('role="status"')
      expect(html).not.toContain(PAYPHONE_NO_CHARGE_COPY)
      expect(html).not.toContain("No se completó el pago")
      expect(html).not.toContain(PAYPHONE_RETRY_LABEL)
      expect(html).not.toContain("payphone-retry")
    }
  })

  it("shows the confirming notice when processing returns to pending, including a forged id", () => {
    expect(shopperOutcomeMessage("pending", "open")).toBe(NOTICE)

    const html = markup({
      state: "confirming",
      code: "pending",
      charge: "open",
    })

    expect(html).toContain(NOTICE)
    expect(html).toContain('role="status"')
    expect(html).not.toContain("No se completó el pago")
    expect(html).not.toContain(PAYPHONE_RETRY_LABEL)
    expect(html).not.toContain("payphone-retry")
  })

  it("keeps the no-charge sentence for a sale that never captured", () => {
    const html = markup({
      state: "no_charge",
      code: "declined",
      charge: "none",
    })

    expect(html).toContain(PAYPHONE_NO_CHARGE_COPY)
    expect(html).not.toContain(PAYPHONE_RETRY_LABEL)
  })
})
