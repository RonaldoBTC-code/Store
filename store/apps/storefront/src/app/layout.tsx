import { getBaseURL } from "@lib/util/env"
import { Metadata } from "next"
import { Chakra_Petch, Sora } from "next/font/google"
import "styles/globals.css"

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  weight: ["400", "600", "700", "800"],
  display: "swap",
})

const chakraPetch = Chakra_Petch({
  subsets: ["latin"],
  variable: "--font-hud",
  weight: ["400", "500", "600", "700"],
  display: "swap",
})

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" data-mode="light" className={`${sora.variable} ${chakraPetch.variable}`}>
      <body className="font-sans antialiased">
        <main className="relative">{props.children}</main>
      </body>
    </html>
  )
}
