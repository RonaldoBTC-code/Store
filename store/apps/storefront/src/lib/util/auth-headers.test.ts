import { describe, expect, it } from "vitest"
import { hasAuthHeaders } from "./auth-headers"

describe("hasAuthHeaders", () => {
  it("treats a missing token object as logged out", () => {
    expect(hasAuthHeaders({})).toBe(false)
    expect(hasAuthHeaders(null)).toBe(false)
    expect(hasAuthHeaders(undefined)).toBe(false)
    expect(hasAuthHeaders({ authorization: "" })).toBe(false)
  })

  it("accepts a bearer token", () => {
    expect(hasAuthHeaders({ authorization: "Bearer token" })).toBe(true)
  })
})
