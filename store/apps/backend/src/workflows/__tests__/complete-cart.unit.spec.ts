import { MedusaError } from "@medusajs/framework/utils"
import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { runCompleteCartWorkflow } from "../complete-payphone-cart"

jest.mock("@medusajs/medusa/core-flows", () => ({
  completeCartWorkflow: jest.fn(),
}))

const mockedCompleteCart = completeCartWorkflow as unknown as jest.Mock

describe("runCompleteCartWorkflow", () => {
  const container = {
    resolve: () => ({
      updatePaymentSession: jest.fn(),
    }),
  }
  const input = {
    cartId: "cart_01",
    sessionId: "payses_01",
    amount: 34.99,
    currencyCode: "usd",
    confirmed: { payphone_confirmed: true },
  }

  it("completes the cart through completeCartWorkflow", async () => {
    const run = jest.fn(async () => ({ result: { id: "order_01" } }))
    mockedCompleteCart.mockReturnValue({ run })

    const result = await runCompleteCartWorkflow(container, input)

    expect(mockedCompleteCart).toHaveBeenCalledWith(container)
    expect(run).toHaveBeenCalledWith({ input: { id: "cart_01" } })
    expect(result).toEqual({ orderId: "order_01" })
  })

  it("does not swallow a validation hook rejection", async () => {
    const run = jest.fn(async () => {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "La cédula o el RUC no es válido."
      )
    })
    mockedCompleteCart.mockReturnValue({ run })

    await expect(runCompleteCartWorkflow(container, input)).rejects.toThrow(
      "La cédula o el RUC no es válido."
    )
  })
})
