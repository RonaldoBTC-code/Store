import type { ReactNode } from "react"

type EditorialShellProps = {
  children: ReactNode
}

/**
 * Dark editorial wrapper. Grain and vignette stay viewport-fixed and
 * below content so they never paint a tall blend layer or eat clicks.
 */
const EditorialShell = ({ children }: EditorialShellProps) => {
  return (
    <div className="editorial-home relative bg-ink-950 text-white">
      <div
        className="editorial-grain-layer pointer-events-none fixed inset-0 z-[1]"
        aria-hidden="true"
      />
      <div
        className="editorial-vignette pointer-events-none fixed inset-0 z-[2]"
        aria-hidden="true"
      />
      <div className="relative z-10">{children}</div>
    </div>
  )
}

export default EditorialShell
