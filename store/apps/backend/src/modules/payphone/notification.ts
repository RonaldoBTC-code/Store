/**
 * PayPhone notification body. A wrong StoreId is rejected before Confirm.
 * https://docs.payphone.app/notificacion-externa
 */
export function readPayphoneNotification(
  body: unknown,
  expectedStoreId: string | undefined
):
  | { action: "ack"; errorCode: "222" | "666" }
  | {
      action: "fulfill"
      clientTransactionId: string
      transactionId: number
    } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { action: "ack", errorCode: "222" }
  }

  const record = body as Record<string, unknown>
  const storeId = readString(record.StoreId) ?? readString(record.storeId)

  if (expectedStoreId && (!storeId || storeId !== expectedStoreId)) {
    return { action: "ack", errorCode: "666" }
  }

  const clientTransactionId =
    readString(record.ClientTransactionId) ??
    readString(record.clientTransactionId)
  const transactionId = readId(record.TransactionId ?? record.transactionId)

  if (!clientTransactionId || !transactionId) {
    return { action: "ack", errorCode: "222" }
  }

  return {
    action: "fulfill",
    clientTransactionId,
    transactionId,
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function readId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
  }

  return undefined
}
