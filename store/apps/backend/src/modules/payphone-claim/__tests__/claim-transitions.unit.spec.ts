import {
  ALLOWED_CLAIM_TRANSITIONS,
  PAYPHONE_CLAIM_STATUSES,
  applyClaimTransition,
  isAllowedClaimTransition,
} from "../claim-transitions"

describe("payphone claim transitions", () => {
  it("rejects every pair that is not an allowed move", () => {
    const allowed = new Set(
      ALLOWED_CLAIM_TRANSITIONS.map(([from, to]) => `${from}->${to}`)
    )
    const forbidden: string[] = []

    for (const from of PAYPHONE_CLAIM_STATUSES) {
      for (const to of PAYPHONE_CLAIM_STATUSES) {
        if (from === to) {
          continue
        }

        const key = `${from}->${to}`
        const row = {
          status: from,
          transactionId: "tx-1",
          orderId: null as string | null,
        }
        const next = applyClaimTransition(row, from, to, {
          orderId: "order_1",
          transactionId: "tx-2",
        })

        if (allowed.has(key)) {
          expect(isAllowedClaimTransition(from, to)).toBe(true)
          expect(next?.status).toBe(to)
          continue
        }

        forbidden.push(key)
        expect(isAllowedClaimTransition(from, to)).toBe(false)
        expect(next).toBeNull()
        expect(row).toEqual({
          status: from,
          transactionId: "tx-1",
          orderId: null,
        })
      }
    }

    expect(forbidden.length).toBe(
      PAYPHONE_CLAIM_STATUSES.length * (PAYPHONE_CLAIM_STATUSES.length - 1) -
        ALLOWED_CLAIM_TRANSITIONS.length
    )
    expect(forbidden).toEqual(
      expect.arrayContaining([
        "captured->rejected",
        "needs_reversal->reversed",
        "needs_reversal->captured",
        "reversed->processing",
        "pending->captured",
        "processing->reversing",
      ])
    )
  })

  it("clears the transaction id only on processing to pending", () => {
    const row = {
      status: "processing",
      transactionId: "tx-1",
      orderId: null,
    }

    expect(
      applyClaimTransition(row, "processing", "pending", {
        clearTransactionId: true,
      })
    ).toMatchObject({ status: "pending", transactionId: null })
  })
})
