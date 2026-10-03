import { Metadata } from "next"

import LoginTemplate from "@modules/account/templates/login-template"

export const metadata: Metadata = {
  title: "Entrar | Gato Gang",
  description: "Entra a tu cuenta de Gato Gang.",
}

export default function Login() {
  return <LoginTemplate />
}
