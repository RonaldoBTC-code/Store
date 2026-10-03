/** @vitest-environment happy-dom */
import React from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import TaxIdField from "./index"

afterEach(() => {
  cleanup()
})

function renderField() {
  return render(
    <TaxIdField taxIdSet={false} taxIdKind={null} requireReentry={false} />
  )
}

function showRuc() {
  renderField()
  fireEvent.change(screen.getByTestId("billing-tax-id-type"), {
    target: { value: "ruc" },
  })
  return screen.getByTestId("billing-razon-social-input") as HTMLInputElement
}

describe("razón social field", () => {
  it("uses a visible label, help text, and organization autocomplete without taking focus", () => {
    const input = showRuc()
    const label = screen.getByText("Razón social").closest("label")

    expect(label?.getAttribute("for")).toBe("billing_address.company")
    expect(input.id).toBe("billing_address.company")
    expect(input.hasAttribute("placeholder")).toBe(false)
    expect(input.autocomplete).toBe("organization")
    expect(input.maxLength).toBe(300)
    expect(input.hasAttribute("autofocus")).toBe(false)
    expect(document.activeElement).not.toBe(input)
    expect(input.getAttribute("aria-invalid")).toBe("false")
    expect(input.getAttribute("aria-describedby")).toBe(
      "billing-razon-social-help"
    )
    expect(screen.getByTestId("billing-razon-social-help").textContent).toBe(
      "Como aparece en tu RUC"
    )
    expect(screen.queryByTestId("billing-razon-social-error")).toBeNull()
  })

  it("marks an empty name invalid and clears the value when the field is hidden", () => {
    const input = showRuc()
    fireEvent.change(input, { target: { value: "Taller Norte" } })
    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.blur(input)

    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(input.getAttribute("aria-describedby")).toBe(
      "billing-razon-social-help billing-razon-social-error"
    )
    expect(screen.getByTestId("billing-razon-social-error").textContent).toBe(
      "Ingresa la razón social para facturar con RUC"
    )

    fireEvent.change(screen.getByTestId("billing-tax-id-type"), {
      target: { value: "cedula" },
    })
    const hidden = document.querySelector(
      'input[name="billing_address.company"]'
    ) as HTMLInputElement
    expect(hidden.type).toBe("hidden")
    expect(hidden.value).toBe("")
    expect(screen.queryByTestId("billing-razon-social-input")).toBeNull()

    fireEvent.change(screen.getByTestId("billing-tax-id-type"), {
      target: { value: "ruc" },
    })
    const shown = screen.getByTestId(
      "billing-razon-social-input"
    ) as HTMLInputElement
    expect(shown.value).toBe("")
    expect(document.activeElement).not.toBe(shown)
  })
})
