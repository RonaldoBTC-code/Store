/**
 * `getAuthHeaders` returns `{}` when no customer token is present.
 * An empty object is truthy, so callers must look for the header itself.
 */
export function hasAuthHeaders(
  headers: object | null | undefined
): headers is { authorization: string } {
  if (!headers || !("authorization" in headers)) {
    return false
  }

  const authorization = (headers as { authorization?: unknown }).authorization

  return typeof authorization === "string" && authorization.length > 0
}
