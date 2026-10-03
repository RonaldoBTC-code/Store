/**
 * Loopback addresses used by CI. The Docker service name `postgres` is not
 * one of them: a host with that name still verifies TLS.
 */
export function isLocalPostgresHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  return host === "localhost" || host === "127.0.0.1" || host === "::1"
}

export function databaseHost(databaseUrl: string | undefined): string {
  if (!databaseUrl) {
    return ""
  }
  try {
    return new URL(databaseUrl).hostname
  } catch {
    return ""
  }
}

export function databaseSsl(
  databaseUrl: string | undefined
): false | { rejectUnauthorized: true } {
  if (isLocalPostgresHost(databaseHost(databaseUrl))) {
    return false
  }
  return { rejectUnauthorized: true }
}
