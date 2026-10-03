import {
  enforceStartupSecrets,
  formatStartupSecretError,
  shouldEnforceStartupSecrets,
  validateProductionSecrets,
} from "../validate-production-secrets"

const validEnv = {
  NODE_ENV: "production",
  JWT_SECRET: "jwt-real-distinto-de-la-plantilla",
  COOKIE_SECRET: "cookie-real-distinta-de-la-plantilla",
  DATABASE_URL: "postgres://usuario:clave-unica@db.interno:5432/medusa",
}

describe("validateProductionSecrets", () => {
  it("no reporta nada cuando los tres valores están definidos y no son la plantilla", () => {
    expect(validateProductionSecrets(validEnv)).toEqual([])
  })

  it("marca secretos vacíos y DATABASE_URL ausente", () => {
    expect(
      validateProductionSecrets({
        JWT_SECRET: "   ",
        COOKIE_SECRET: "",
      })
    ).toEqual([
      { variable: "JWT_SECRET", code: "missing" },
      { variable: "COOKIE_SECRET", code: "missing" },
      { variable: "DATABASE_URL", code: "missing" },
    ])
  })

  it("marca el valor de plantilla sin distinguir mayúsculas", () => {
    expect(
      validateProductionSecrets({
        ...validEnv,
        JWT_SECRET: "supersecret",
        COOKIE_SECRET: "SuperSecret",
      })
    ).toEqual([
      { variable: "JWT_SECRET", code: "template" },
      { variable: "COOKIE_SECRET", code: "template" },
    ])
  })
})

describe("shouldEnforceStartupSecrets", () => {
  const production = { NODE_ENV: "production" }

  it("corre en medusa start y medusa develop en producción", () => {
    expect(
      shouldEnforceStartupSecrets(production, ["node", "cli.js", "start"])
    ).toBe(true)
    expect(
      shouldEnforceStartupSecrets(production, ["node", "cli.js", "develop"])
    ).toBe(true)
  })

  it("no corre en build, migraciones, seeds ni fuera de producción", () => {
    expect(
      shouldEnforceStartupSecrets(production, ["node", "cli.js", "build"])
    ).toBe(false)
    expect(
      shouldEnforceStartupSecrets(production, [
        "node",
        "cli.js",
        "db:migrate",
      ])
    ).toBe(false)
    expect(
      shouldEnforceStartupSecrets(production, [
        "node",
        "cli.js",
        "exec",
        "./src/scripts/seed.ts",
      ])
    ).toBe(false)
    expect(
      shouldEnforceStartupSecrets(
        { NODE_ENV: "development" },
        ["node", "cli.js", "start"]
      )
    ).toBe(false)
    expect(
      shouldEnforceStartupSecrets(
        { NODE_ENV: "test" },
        ["node", "cli.js", "develop"]
      )
    ).toBe(false)
  })

  it("no corre en CI aunque el comando sea start y NODE_ENV=production", () => {
    expect(
      shouldEnforceStartupSecrets(
        { NODE_ENV: "production", CI: "true" },
        ["node", "cli.js", "start"]
      )
    ).toBe(false)
    expect(
      shouldEnforceStartupSecrets(
        { NODE_ENV: "production", GITHUB_ACTIONS: "true" },
        ["node", "cli.js", "develop"]
      )
    ).toBe(false)
  })
})

describe("enforceStartupSecrets", () => {
  it("lanza en producción al arrancar si falta un secreto, sin incluir el valor", () => {
    const databaseUrl = "postgres://usuario:NO-MOSTRAR-ESTA-CLAVE@db/medusa"

    expect(() =>
      enforceStartupSecrets(
        {
          NODE_ENV: "production",
          JWT_SECRET: "supersecret",
          COOKIE_SECRET: "cookie-real-distinta",
          DATABASE_URL: "",
        },
        ["node", "cli.js", "start"]
      )
    ).toThrow(/JWT_SECRET/)

    try {
      enforceStartupSecrets(
        {
          NODE_ENV: "production",
          JWT_SECRET: "supersecret",
          COOKIE_SECRET: "cookie-real-distinta",
          DATABASE_URL: databaseUrl,
        },
        ["node", "cli.js", "start"]
      )
      throw new Error("debía fallar")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      const message = (error as Error).message
      expect(message).not.toContain("supersecret")
      expect(message).not.toContain(databaseUrl)
      expect(message).not.toContain("cookie-real-distinta")
      expect(message).toContain("openssl rand -base64 48")
    }
  })

  it("no hace nada durante medusa build aunque NODE_ENV sea production", () => {
    expect(() =>
      enforceStartupSecrets(
        {
          NODE_ENV: "production",
          JWT_SECRET: "supersecret",
        },
        ["node", "cli.js", "build"]
      )
    ).not.toThrow()
  })

  it("describe los problemas sin volcar secretos", () => {
    const message = formatStartupSecretError([
      { variable: "COOKIE_SECRET", code: "template" },
      { variable: "DATABASE_URL", code: "missing" },
    ])

    expect(message).toContain("COOKIE_SECRET")
    expect(message).toContain("DATABASE_URL")
    expect(message).not.toContain("supersecret")
  })
})
