/**
 * Reads the cart cookie and fails when it is missing.
 * The read is async; callers must await this so a Promise is never treated as an id.
 */
export async function resolveCartId(
  getCartId: () => Promise<string | undefined | null>
): Promise<string> {
  const cartId = await getCartId()

  if (!cartId) {
    throw new Error("No existing cart found when setting addresses")
  }

  return cartId
}

/** Waits until the cart cookie has been cleared before the caller redirects. */
export async function clearStoredCartId(
  removeCartId: () => Promise<void>
): Promise<void> {
  await removeCartId()
}
