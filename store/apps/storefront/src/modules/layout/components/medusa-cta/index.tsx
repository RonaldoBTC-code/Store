import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { Text } from "@modules/common/components/ui"

const MedusaCTA = () => {
  return (
    <Text className="txt-compact-small-plus text-white/45">
      <LocalizedClientLink href="/" className="transition hover:text-neon">
        Gato Gang
      </LocalizedClientLink>
    </Text>
  )
}

export default MedusaCTA
