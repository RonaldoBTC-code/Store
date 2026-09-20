import { getBaseURL } from "@lib/util/env"
import { Metadata } from "next"
import { IBM_Plex_Mono, Sora } from "next/font/google"
import "styles/globals.css"

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  weight: ["400", "600", "700", "800"],
  display: "swap",
})

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-hud",
  weight: ["400", "500", "600"],
  display: "swap",
})

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
  title: {
    default: "Gato Gang",
    template: "%s",
  },
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-mode="dark"
      className={`dark ${sora.variable} ${ibmPlexMono.variable} bg-ink-950`}
    >
      <body className="bg-ink-950 font-sans antialiased text-white">
        <main className="relative min-h-dvh bg-ink-950 text-white">
          {props.children}
        </main>
      </body>
    </html>
  )
}
