import { HttpTypes } from "@medusajs/types"
import { NextRequest, NextResponse } from "next/server"
import {
  loadRegionMap,
  pickCountryCode,
  type RegionMapCache,
} from "./lib/util/request-region"

const BACKEND_URL = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
const PUBLISHABLE_API_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
const DEFAULT_REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "ec"

const regionMapCache: RegionMapCache<HttpTypes.StoreRegion> = {
  map: new Map<string, HttpTypes.StoreRegion>(),
  updatedAt: 0,
}

function continueWithCountry(
  request: NextRequest,
  country: string,
  cacheId: string,
  hasCacheCookie: boolean
) {
  const firstPathSegment = request.nextUrl.pathname.split("/")[1]?.toLowerCase()
  const urlHasCountry = firstPathSegment === country.toLowerCase()

  if (urlHasCountry) {
    if (!hasCacheCookie) {
      const response = NextResponse.next()
      response.cookies.set("_medusa_cache_id", cacheId, {
        maxAge: 60 * 60 * 24,
      })
      return response
    }
    return NextResponse.next()
  }

  const redirectPath =
    request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname
  const queryString = request.nextUrl.search || ""
  const redirectUrl = `${request.nextUrl.origin}/${country}${redirectPath}${queryString}`

  return NextResponse.redirect(redirectUrl, 307)
}

/**
 * Middleware to handle region selection and onboarding status.
 * If Medusa cannot be reached, fall back to the default region so pages
 * can render their own error state instead of a site-wide 500.
 */
export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.includes(".")) {
    return NextResponse.next()
  }

  const cacheIdCookie = request.cookies.get("_medusa_cache_id")
  const cacheId = cacheIdCookie?.value || crypto.randomUUID()

  try {
    const regionMap = await loadRegionMap({
      backendUrl: BACKEND_URL,
      publishableKey: PUBLISHABLE_API_KEY,
      cache: regionMapCache,
      cacheId,
    })
    const country = pickCountryCode({
      pathname: request.nextUrl.pathname,
      regionMap,
      cloudflareCountry: (request as { cf?: { country?: string } }).cf?.country,
      vercelCountry: request.headers.get("x-vercel-ip-country"),
      defaultRegion: DEFAULT_REGION,
    })

    return continueWithCountry(
      request,
      country,
      cacheId,
      Boolean(cacheIdCookie)
    )
  } catch {
    console.error("Region lookup failed; falling back to the default region.")
    return continueWithCountry(
      request,
      DEFAULT_REGION,
      cacheId,
      Boolean(cacheIdCookie)
    )
  }
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|images|assets|png|svg|jpg|jpeg|gif|webp).*)",
  ],
}
