const SkeletonProductPreview = () => {
  return (
    <div className="animate-pulse">
      <div className="aspect-square w-full bg-transparent" />
      <div className="flex justify-between text-base-regular mt-2">
        <div className="h-6 w-2/5 bg-white/10"></div>
        <div className="h-6 w-1/5 bg-white/10"></div>
      </div>
    </div>
  )
}

export default SkeletonProductPreview
