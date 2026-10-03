import { describe, expect, it } from "vitest"
import { paymentReturnUrl } from "./payment-return-url"

describe("paymentReturnUrl", () => {
  it("keeps the cart id and invoice id out of the return URL", () => {
    const url = new URL(paymentReturnUrl("https://shop.example", "ec"))

    expect(url.pathname).toBe("/api/payment-return")
    expect(url.searchParams.get("country_code")).toBe("ec")
    expect(url.searchParams.has("cart_id")).toBe(false)
    expect(url.searchParams.has("tax_id")).toBe(false)
    expect(url.toString()).not.toMatch(/cart_|1710034065|tax_id/)
  })
})
