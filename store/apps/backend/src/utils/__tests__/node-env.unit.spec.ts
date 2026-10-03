import { isProductionEnv } from "../node-env"

describe("isProductionEnv", () => {
  it.each(["Production", " production ", "prod", "PRODUCTION"])(
    "trata %j como producción",
    (nodeEnv) => {
      expect(isProductionEnv(nodeEnv)).toBe(true)
    }
  )

  it("no trata local, test ni vacío como producción", () => {
    expect(isProductionEnv("development")).toBe(false)
    expect(isProductionEnv("test")).toBe(false)
    expect(isProductionEnv(" productionx ")).toBe(false)
    expect(isProductionEnv("  ")).toBe(false)
    expect(isProductionEnv(undefined)).toBe(false)
  })
})
