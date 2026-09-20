import type { ReactNode } from "react"

type EditorialShellProps = {
  children: ReactNode
}

/**
 * Dark editorial wrapper with grain overlay for the Gato Gang homepage.
 */
const EditorialShell = ({ children }: EditorialShellProps) => {
  return (
    <div className="editorial-grain relative bg-ink-950 text-white">
      <div className="relative z-10">{children}</div>
    </div>
  )
}

export default EditorialShell
