import { Button, Heading, Text } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

const SignInPrompt = () => {
  return (
    <div className="flex items-center justify-between bg-ink-950 text-white">
      <div>
        <Heading level="h2" className="txt-xlarge text-white">
          ¿Ya tienes cuenta?
        </Heading>
        <Text className="txt-medium mt-2 text-white/75">
          Entra y seguimos más rápido.
        </Text>
      </div>
      <div>
        <LocalizedClientLink href="/account">
          <Button variant="secondary" className="h-10" data-testid="sign-in-button">
            Entrar
          </Button>
        </LocalizedClientLink>
      </div>
    </div>
  )
}

export default SignInPrompt
