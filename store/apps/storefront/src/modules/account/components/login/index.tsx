import { login } from "@lib/data/customer"
import { LOGIN_VIEW } from "@modules/account/templates/login-template"
import ErrorMessage from "@modules/checkout/components/error-message"
import { SubmitButton } from "@modules/checkout/components/submit-button"
import Input from "@modules/common/components/input"
import { useActionState } from "react"

type Props = {
  setCurrentView: (view: LOGIN_VIEW) => void
}

const Login = ({ setCurrentView }: Props) => {
  const [message, formAction] = useActionState(login, null)

  return (
    <div
      className="max-w-sm w-full flex flex-col items-center"
      data-testid="login-page"
    >
      <h1 className="text-large-semi uppercase mb-6">Qué bueno verte</h1>
      <p className="text-center text-base-regular text-ui-fg-base mb-8">
        Entra a tu cuenta para comprar más rápido.
      </p>
      {message?.state === "verification_required" && (
        <div
          className="w-full mb-6 text-center text-base-regular text-ui-fg-base bg-ui-bg-subtle border border-ui-border-base rounded-rounded p-4"
          data-testid="login-verification-message"
        >
          Te mandamos un enlace a <strong>{message.email}</strong>. Confirma
          el correo y entra.
        </div>
      )}
      <form className="w-full" action={formAction}>
        <div className="flex flex-col w-full gap-y-2">
          <Input
            label="Correo"
            name="email"
            type="email"
            title="Ingresa un correo válido."
            autoComplete="email"
            required
            data-testid="email-input"
          />
          <Input
            label="Contraseña"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            data-testid="password-input"
          />
        </div>
        <ErrorMessage
          error={message?.state === "error" ? message.error : null}
          data-testid="login-error-message"
        />
        <SubmitButton data-testid="sign-in-button" className="w-full mt-6">
          Entrar
        </SubmitButton>
      </form>
      <span className="text-center text-ui-fg-base text-small-regular mt-6">
        ¿Sin cuenta?{" "}
        <button
          onClick={() => setCurrentView(LOGIN_VIEW.REGISTER)}
          className="underline"
          data-testid="register-button"
        >
          Crear cuenta
        </button>
        .
      </span>
    </div>
  )
}

export default Login
