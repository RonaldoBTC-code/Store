import { describe, expect, it } from "vitest"
import { clearStoredCartId, resolveCartId } from "./cart-guards"

describe("resolveCartId", () => {
  it("awaits the cookie read before deciding the cart is missing", async () => {
    let settled = false
    const read = () =>
      new Promise<string | undefined>((resolve) => {
        setTimeout(() => {
          settled = true
          resolve(undefined)
        }, 20)
      })

    const pending = resolveCartId(read)
    expect(settled).toBe(false)

    await expect(pending).rejects.toThrow(
      "No existing cart found when setting addresses"
    )
    expect(settled).toBe(true)
  })

  it("returns the id from the resolved cookie", async () => {
    await expect(resolveCartId(async () => "cart_123")).resolves.toBe(
      "cart_123"
    )
  })
})

describe("clearStoredCartId", () => {
  it("waits until the cart cookie removal finishes", async () => {
    let cleared = false
    const pending = clearStoredCartId(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            cleared = true
            resolve()
          }, 20)
        })
    )

    expect(cleared).toBe(false)
    await pending
    expect(cleared).toBe(true)
  })
})
