export type ClaimInput = {
  invoiceId: string
  cartId: string
  paymentSessionId: string
  amountCents: number
  currencyCode: string
}

export type ClaimResult = "claimed" | "replay"

export interface BtcpayClaimStore {
  claim(input: ClaimInput): Promise<ClaimResult>
}

export function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>()

  const walk = (value: unknown): boolean => {
    if (!value || typeof value !== "object" || seen.has(value)) {
      return false
    }
    seen.add(value)
    const record = value as {
      code?: unknown
      message?: unknown
      name?: unknown
      cause?: unknown
    }
    if (record.code === "23505") {
      return true
    }
    if (record.name === "UniqueConstraintViolationException") {
      return true
    }
    if (
      typeof record.message === "string" &&
      /duplicate key|unique constraint|already exists/i.test(record.message)
    ) {
      return true
    }
    return walk(record.cause)
  }

  return walk(error)
}

export async function claimOnce(
  insert: () => Promise<void>
): Promise<ClaimResult> {
  try {
    await insert()
    return "claimed"
  } catch (error) {
    if (isUniqueViolation(error)) {
      return "replay"
    }
    throw error
  }
}

/**
 * Test double with the same uniqueness rule as the invoice_id unique index.
 * A queued critical section keeps overlapping confirmations to one winner.
 */
export class MemoryBtcpayClaimStore implements BtcpayClaimStore {
  private readonly invoiceIds = new Set<string>()
  private chain: Promise<void> = Promise.resolve()

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const run = async () => {
      await new Promise((resolve) => setTimeout(resolve, 15))
      if (this.invoiceIds.has(input.invoiceId)) {
        return "replay" as const
      }
      this.invoiceIds.add(input.invoiceId)
      return "claimed" as const
    }

    const result = this.chain.then(run, run)
    this.chain = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
