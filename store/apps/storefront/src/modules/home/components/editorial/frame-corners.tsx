type FrameCornersProps = {
  className?: string
}

/**
 * Viewfinder corners for cinematic editorial chapters.
 */
const FrameCorners = ({ className }: FrameCornersProps) => {
  return (
    <div
      className={`pointer-events-none absolute inset-4 small:inset-7 ${className ?? ""}`}
      aria-hidden="true"
    >
      <span className="absolute left-0 top-0 h-10 w-10 border-l border-t border-white/40" />
      <span className="absolute right-0 top-0 h-10 w-10 border-r border-t border-white/40" />
      <span className="absolute bottom-0 left-0 h-10 w-10 border-b border-l border-white/40" />
      <span className="absolute bottom-0 right-0 h-10 w-10 border-b border-r border-white/40" />
    </div>
  )
}

export default FrameCorners
