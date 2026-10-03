import { Heading, Text } from "@modules/common/components/ui"

import InteractiveLink from "@modules/common/components/interactive-link"

const EmptyCartMessage = () => {
  return (
    <div className="py-48 px-2 flex flex-col justify-center items-start" data-testid="empty-cart-message">
      <Heading
        level="h1"
        className="flex flex-row items-baseline gap-x-2 font-display text-4xl font-extrabold text-white"
      >
        Carrito
      </Heading>
      <Text className="mb-6 mt-4 max-w-[32rem] text-base-regular text-white/75">
        El carrito está vacío. Hay gorras esperando.
      </Text>
      <div>
        <InteractiveLink href="/store">Ver gorras</InteractiveLink>
      </div>
    </div>
  )
}

export default EmptyCartMessage
