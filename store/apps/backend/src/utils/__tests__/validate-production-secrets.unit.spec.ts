import {
  enforceStartupSecrets,
  formatStartupSecretError,
  shouldEnforceStartupSecrets,
  validateProductionSecrets,
} from "../validate-production-secrets"

const JWT_OK = "j".repeat(32)
const COOKIE_OK = "c".repeat(32)
const DATABASE_URL = "postgres://usuario:NO-MOSTRAR-ESTA-CLAVE@db.interno:5432/medusa"

const validEnv = {
  NODE_ENV: "production",
  JWT_SECRET: JWT_OK,
  COOKIE_SECRET: COOKIE_OK,
  DATABASE_URL,
}

const startArgv = ["node", "cli.js", "start"]

describe("validateProductionSecrets", () => {
  it("no reporta nada cuando los secretos son largos, distintos y no son plantilla", () => {
    expect(validateProductionSecrets(validEnv)).toEqual([])
  })

  it("marca el valor vacío de .env.template como ausente", () => {
    expect(
      validateProductionSecrets({
        JWT_SECRET: "",
        COOKIE_SECRET: "   ",
        DATABASE_URL: "   ",
      })
    ).toEqual([
      { variable: "JWT_SECRET", code: "missing" },
      { variable: "COOKIE_SECRET", code: "missing" },
      { variable: "DATABASE_URL", code: "missing" },
    ])
  })

  it.each(["supersecret", "changeme", "secret", "password", "ChangeMe", "PASSWORD"])(
    "marca %j como plantilla y el mensaje no incluye el valor",
    (template) => {
      const issues = validateProductionSecrets({
        ...validEnv,
        JWT_SECRET: template,
      })

      expect(issues).toContainEqual({ variable: "JWT_SECRET", code: "template" })

      const message = formatStartupSecretError(issues)
      expect(message).toContain("JWT_SECRET")
      expect(message).toContain("plantilla")
      expect(message).not.toContain(template)
      expect(message).not.toContain(DATABASE_URL)
    }
  )

  it("rechaza un secreto de menos de 32 caracteres sin imprimirlo", () => {
    const corto = "x".repeat(31)
    const issues = validateProductionSecrets({
      ...validEnv,
      COOKIE_SECRET: corto,
    })

    expect(issues).toEqual([
      { variable: "COOKIE_SECRET", code: "too_short" },
    ])

    const message = formatStartupSecretError(issues)
    expect(message).toContain("COOKIE_SECRET")
    expect(message).toContain("32")
    expect(message).not.toContain(corto)
  })

  it("acepta 32 caracteres justos si no es plantilla ni está repetido", () => {
    expect(
      validateProductionSecrets({
        JWT_SECRET: "a".repeat(32),
        COOKIE_SECRET: "b".repeat(32),
        DATABASE_URL: "postgres://localhost/medusa",
      })
    ).toEqual([])
  })

  it("rechaza secretos iguales sin imprimir el valor compartido", () => {
    const compartido = "q".repeat(40)
    const issues = validateProductionSecrets({
      ...validEnv,
      JWT_SECRET: compartido,
      COOKIE_SECRET: compartido,
    })

    expect(issues).toEqual([{ variable: "JWT_SECRET", code: "equal" }])

    const message = formatStartupSecretError(issues)
    expect(message).toContain("JWT_SECRET")
    expect(message).toContain("COOKIE_SECRET")
    expect(message).toContain("iguales")
    expect(message).not.toContain(compartido)
    expect(message).not.toContain(DATABASE_URL)
  })
})

describe("shouldEnforceStartupSecrets", () => {
  it("corre en medusa start y medusa develop en producción", () => {
    expect(
      shouldEnforceStartupSecrets(
        { NODE_ENV: "production" },
        startArgv
      )
    ).toBe(true)
    expect(
      shouldEnforceStartupSecrets(
        { NODE_ENV: "prod" },
        ["node", "cli.js", "develop"]
      )
    ).toBe(true)
  })

  it("corre si el comando es desconocido o no hay argumentos", () => {
    expect(
      shouldEnforceStartupSecrets(
        { NODE_ENV: "production" },
        ["node", "cli.js", "lint"]
      )
    ).toBe(true)
    expect(
      shouldEnforceStartupSecrets(
        { NODE_ENV: "production" },
        ["node", "cli.js", "no-existe"]
      )
    ).toBe(true)
    expect(
      shouldEnforceStartupSecrets(
        { NODE_ENV: "production" },
        ["node", "cli.js"]
      )
    ).toBe(true)
    expect(
      shouldEnforceStartupSecrets({ NODE_ENV: "production" }, ["node"])
    ).toBe(true)
    expect(
      shouldEnforceStartupSecrets(
        { NODE_ENV: "production" },
        ["node", "cli.js", "--json", "start"]
      )
    ).toBe(true)
  })

  it.each([
    ["node", "cli.js", "build"],
    ["node", "cli.js", "db:setup"],
    ["node", "cli.js", "db:create"],
    ["node", "cli.js", "db:migrate"],
    ["node", "cli.js", "db:migrate:scripts"],
    ["node", "cli.js", "db:migrate:search"],
    ["node", "cli.js", "db:rollback"],
    ["node", "cli.js", "db:generate"],
    ["node", "cli.js", "db:sync-links"],
    ["node", "cli.js", "exec", "./src/scripts/seed.ts"],
    ["node", "cli.js", "exec", "start"],
    ["node", "cli.js", "user", "-e", "a@b.c", "-p", "x"],
    ["node", "cli.js", "plugin:build"],
    ["node", "cli.js", "plugin:develop"],
    ["node", "cli.js", "plugin:publish"],
    ["node", "cli.js", "plugin:add"],
    ["node", "cli.js", "plugin:db:generate"],
    ["node", "cli.js", "--verbose", "db:migrate"],
  ])("no corre en la excepción %j", (...argv) => {
    expect(
      shouldEnforceStartupSecrets({ NODE_ENV: "production" }, argv)
    ).toBe(false)
  })

  it.each(["Production", " production ", "prod", "PRODUCTION"])(
    "corre con NODE_ENV=%j",
    (nodeEnv) => {
      expect(
        shouldEnforceStartupSecrets({ NODE_ENV: nodeEnv }, startArgv)
      ).toBe(true)
    }
  )

  it("corre con CI=true y NODE_ENV=production", () => {
    expect(
      shouldEnforceStartupSecrets(
        { NODE_ENV: "production", CI: "true", GITHUB_ACTIONS: "true" },
        startArgv
      )
    ).toBe(true)
  })

  it("no corre sin UNSAFE_SKIP en build, migraciones, seeds ni fuera de producción", () => {
    expect(
      shouldEnforceStartupSecrets(
        { NODE_ENV: "production" },
        ["node", "cli.js", "build"]
      )
    ).toBe(false)
    expect(
      shouldEnforceStartupSecrets(
        { NODE_ENV: "production" },
        ["node", "cli.js", "db:migrate"]
      )
    ).toBe(false)
    expect(
      shouldEnforceStartupSecrets(
        { NODE_ENV: "production" },
        ["node", "cli.js", "exec", "./src/scripts/seed.ts"]
      )
    ).toBe(false)
    expect(
      shouldEnforceStartupSecrets(
        { NODE_ENV: "development" },
        startArgv
      )
    ).toBe(false)
  })

  it("UNSAFE_SKIP_STARTUP_CHECKS salta solo el chequeo de secretos", () => {
    expect(
      shouldEnforceStartupSecrets(
        {
          NODE_ENV: "production",
          CI: "true",
          UNSAFE_SKIP_STARTUP_CHECKS: "true",
        },
        startArgv
      )
    ).toBe(false)
  })
})

describe("enforceStartupSecrets", () => {
  it("falla el arranque con CI=true y NODE_ENV=production sin secretos", () => {
    expect(() =>
      enforceStartupSecrets(
        {
          NODE_ENV: "production",
          CI: "true",
          GITLAB_CI: "true",
        },
        startArgv,
        jest.fn()
      )
    ).toThrow(/JWT_SECRET/)
  })

  it("sin UNSAFE_SKIP_STARTUP_CHECKS el chequeo corre y no imprime valores", () => {
    const warn = jest.fn()

    try {
      enforceStartupSecrets(
        {
          NODE_ENV: " PRODUCTION ",
          JWT_SECRET: "supersecret",
          COOKIE_SECRET: COOKIE_OK,
          DATABASE_URL,
        },
        startArgv,
        warn
      )
      throw new Error("debía fallar")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      const message = (error as Error).message
      expect(message).toContain("JWT_SECRET")
      expect(message).toContain("plantilla")
      expect(message).not.toContain("supersecret")
      expect(message).not.toContain(DATABASE_URL)
      expect(message).not.toContain(COOKIE_OK)
    }

    expect(warn).not.toHaveBeenCalled()
  })

  it("con UNSAFE_SKIP_STARTUP_CHECKS omite secretos, avisa y no toca el SSL", () => {
    const warn = jest.fn()

    expect(() =>
      enforceStartupSecrets(
        {
          NODE_ENV: "prod",
          CI: "true",
          UNSAFE_SKIP_STARTUP_CHECKS: "true",
          JWT_SECRET: "supersecret",
          COOKIE_SECRET: "password",
          DATABASE_URL,
        },
        startArgv,
        warn
      )
    ).not.toThrow()

    expect(warn).toHaveBeenCalledTimes(1)
    const message = warn.mock.calls[0][0] as string
    expect(message).toContain("UNSAFE_SKIP_STARTUP_CHECKS")
    expect(message).toContain("SSL")
    expect(message).not.toContain("supersecret")
    expect(message).not.toContain("password")
    expect(message).not.toContain(DATABASE_URL)
  })

  it("un comando desconocido en producción ejecuta el chequeo", () => {
    expect(() =>
      enforceStartupSecrets(
        { NODE_ENV: "production" },
        ["node", "cli.js", "lint"],
        jest.fn()
      )
    ).toThrow(/JWT_SECRET/)
  })

  it("no avisa ni falla durante medusa build", () => {
    const warn = jest.fn()

    expect(() =>
      enforceStartupSecrets(
        {
          NODE_ENV: "production",
          UNSAFE_SKIP_STARTUP_CHECKS: "true",
          JWT_SECRET: "supersecret",
        },
        ["node", "cli.js", "build"],
        warn
      )
    ).not.toThrow()

    expect(warn).not.toHaveBeenCalled()
  })
})
