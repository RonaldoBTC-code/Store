import { HttpTypes } from "@medusajs/types"
import { PACKSHOTS } from "@modules/home/components/editorial/packshots"
import Image from "next/image"

type ImageGalleryProps = {
  images: HttpTypes.StoreProductImage[]
}

const altFor = (url: string | null | undefined, index: number) => {
  const packshot = PACKSHOTS.find((item) =>
    url?.includes(`${item.handle}-dad-hat-gato-gang`)
  )
  return packshot?.alt ?? `Product image ${index + 1}`
}

const ImageGallery = ({ images }: ImageGalleryProps) => {
  return (
    <div className="relative flex items-start">
      <div className="flex w-full flex-1 flex-col gap-y-4 small:px-6">
        {images.map((image, index) => {
          return (
            <div
              key={image.id}
              className="relative aspect-square w-full overflow-hidden bg-ink-950"
              id={image.id}
            >
              {!!image.url && (
                <Image
                  src={image.url}
                  priority={index <= 2 ? true : false}
                  className="absolute inset-0 object-contain object-center p-4"
                  alt={altFor(image.url, index)}
                  fill
                  sizes="(max-width: 576px) 280px, (max-width: 768px) 360px, (max-width: 992px) 480px, 800px"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ImageGallery
