const checkEnvVariables = require("./check-env-variables")

checkEnvVariables()

/**
 * Medusa Cloud-related environment variables
 */
const S3_HOSTNAME = process.env.MEDUSA_CLOUD_S3_HOSTNAME
const S3_PATHNAME = process.env.MEDUSA_CLOUD_S3_PATHNAME

/** Same fallback as src/lib/config.ts when NEXT_PUBLIC_MEDUSA_BACKEND_URL is unset. */
const MEDUSA_BACKEND_FALLBACK = "http://localhost:9000"

/**
 * Parse an absolute URL into an origin safe to embed in a CSP directive.
 * Returns null for empty or invalid values so next.config cannot crash the build.
 * @param {string | undefined} value
 * @returns {string | null}
 */
function originFromUrl(value) {
  if (!value || !String(value).trim()) {
    return null
  }

  try {
    const origin = new URL(String(value).trim()).origin
    if (/^[a-z][a-z0-9+.-]*:\/\/[a-z0-9.*\-\[\]:]+$/i.test(origin)) {
      return origin
    }
    return null
  } catch {
    return null
  }
}

/**
 * Host or absolute URL -> CSP origin. Bare hosts are treated as https.
 * @param {string | undefined} value
 * @returns {string | null}
 */
function originFromHostOrUrl(value) {
  if (!value || !String(value).trim()) {
    return null
  }

  const trimmed = String(value).trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return originFromUrl(trimmed)
  }

  return originFromUrl(`https://${trimmed}`)
}

function medusaBackendOrigin() {
  const configured = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
  const candidate =
    configured && String(configured).trim() ? configured : MEDUSA_BACKEND_FALLBACK

  return originFromUrl(candidate) || originFromUrl(MEDUSA_BACKEND_FALLBACK)
}

/**
 * @param {Array<string | null | undefined>} sources
 * @returns {string[]}
 */
function uniqueSources(sources) {
  const seen = new Set()
  const result = []

  for (const source of sources) {
    if (!source || seen.has(source)) {
      continue
    }
    seen.add(source)
    result.push(source)
  }

  return result
}

function contentSecurityPolicy() {
  const isDev = process.env.NODE_ENV === "development"
  const backendOrigin = medusaBackendOrigin()
  const imageHosts = uniqueSources([
    originFromHostOrUrl(process.env.NEXT_PUBLIC_IMAGE_HOST),
    originFromHostOrUrl(process.env.MEDUSA_CLOUD_S3_HOSTNAME),
  ])

  const scriptSrc = ["'self'", "'unsafe-inline'"]
  if (isDev) {
    scriptSrc.push("'unsafe-eval'")
  }

  const imgSrc = uniqueSources([
    "'self'",
    "data:",
    "blob:",
    backendOrigin,
    ...imageHosts,
  ])
  const connectSrc = uniqueSources(["'self'", backendOrigin])

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc.join(" ")}`,
    "media-src 'self'",
    "font-src 'self'",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ")
}

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "https",
        hostname: "*.s3.*.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "*.s3.amazonaws.com",
      },
      ...(S3_HOSTNAME && S3_PATHNAME
        ? [
            {
              protocol: "https",
              hostname: S3_HOSTNAME,
              pathname: S3_PATHNAME,
            },
          ]
        : []),
    ],
  },
  async headers() {
    /** @type {{ key: string, value: string }[]} */
    const securityHeaders = [
      {
        key: "Content-Security-Policy-Report-Only",
        value: contentSecurityPolicy(),
      },
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(self)",
      },
    ]

    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains",
      })
    }

    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ]
  },
}

module.exports = nextConfig
