import { createRequire } from "module"
import {
  productionSslDisabledWarning,
  resolveDatabaseConnection,
  resolveDatabaseSsl,
  sanitizeDatabaseUrl,
  warnIfProductionSslDisabled,
} from "../database-ssl"

const PEM = "-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----"
const DATABASE_URL = "postgres://usuario:NO-MOSTRAR-URL@db.interno:5432/medusa"

describe("resolveDatabaseSsl", () => {
  it("apaga SSL fuera de producción cuando DATABASE_SSL no está definida", () => {
    expect(resolveDatabaseSsl({ NODE_ENV: "development" })).toBe(false)
    expect(resolveDatabaseSsl({})).toBe(false)
    expect(resolveDatabaseSsl({ NODE_ENV: "test" })).toBe(false)
  })

  it("enciende SSL con verificación en producción aunque CI esté definido", () => {
    expect(
      resolveDatabaseSsl({
        NODE_ENV: "production",
        CI: "true",
        DATABASE_URL,
      })
    ).toEqual({ rejectUnauthorized: true })

    expect(
      resolveDatabaseSsl({
        NODE_ENV: "prod",
        GITHUB_ACTIONS: "true",
        UNSAFE_SKIP_STARTUP_CHECKS: "true",
        DATABASE_URL,
      })
    ).toEqual({ rejectUnauthorized: true })
  })

  it.each(["Production", " production ", "prod", "PRODUCTION"])(
    "verifica el certificado con NODE_ENV=%j",
    (nodeEnv) => {
      expect(resolveDatabaseSsl({ NODE_ENV: nodeEnv })).toEqual({
        rejectUnauthorized: true,
      })
    }
  )

  it("DATABASE_SSL=false gana incluso en producción", () => {
    expect(
      resolveDatabaseSsl({
        NODE_ENV: "production",
        DATABASE_SSL: "false",
        DATABASE_URL,
      })
    ).toBe(false)
  })

  it("DATABASE_SSL=true verifica el certificado también en local", () => {
    expect(
      resolveDatabaseSsl({
        NODE_ENV: "development",
        DATABASE_SSL: "true",
      })
    ).toEqual({ rejectUnauthorized: true })
  })

  it("acepta un CA en PEM y no lo registra", () => {
    const ssl = resolveDatabaseSsl(
      {
        DATABASE_SSL: "require",
        DATABASE_CA_CERT: PEM,
      },
      () => {
        throw new Error("no debía leer un archivo")
      }
    )

    expect(ssl).toEqual({
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
    })
  })

  it("lee el CA desde una ruta cuando no es un PEM", () => {
    const readCaFile = jest
      .fn()
      .mockReturnValue(
        "-----BEGIN CERTIFICATE-----\nFILE\n-----END CERTIFICATE-----\n"
      )

    expect(
      resolveDatabaseSsl(
        {
          DATABASE_SSL: "on",
          DATABASE_CA_CERT: "/etc/ssl/proveedor-ca.pem",
        },
        readCaFile
      )
    ).toEqual({
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----\nFILE\n-----END CERTIFICATE-----\n",
    })
    expect(readCaFile).toHaveBeenCalledWith("/etc/ssl/proveedor-ca.pem")
  })

  it("no lee el CA si SSL está apagado", () => {
    const readCaFile = jest.fn()

    expect(
      resolveDatabaseSsl(
        {
          DATABASE_SSL: "0",
          DATABASE_CA_CERT: "/no/existe.pem",
        },
        readCaFile
      )
    ).toBe(false)
    expect(readCaFile).not.toHaveBeenCalled()
  })

  it("falla si la ruta del CA no se puede leer, sin volcar el contenido", () => {
    const secreto = "MATERIAL-SECRETO-DEL-DISCO"

    expect(() =>
      resolveDatabaseSsl(
        {
          NODE_ENV: "production",
          DATABASE_CA_CERT: "/var/ca/missing.pem",
        },
        () => {
          throw new Error(secreto)
        }
      )
    ).toThrow(/DATABASE_CA_CERT/)

    try {
      resolveDatabaseSsl(
        {
          NODE_ENV: "production",
          DATABASE_CA_CERT: "/var/ca/missing.pem",
        },
        () => {
          throw new Error(secreto)
        }
      )
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).not.toContain(secreto)
    }
  })

  it("DATABASE_SSL=require y cualquier valor distinto de false verifican el certificado", () => {
    expect(resolveDatabaseSsl({ DATABASE_SSL: "require" })).toEqual({
      rejectUnauthorized: true,
    })
    expect(resolveDatabaseSsl({ DATABASE_SSL: "maybe" })).toEqual({
      rejectUnauthorized: true,
    })
    expect(resolveDatabaseSsl({ DATABASE_SSL: "verify-full" })).toEqual({
      rejectUnauthorized: true,
    })
  })
})

const USER = "usuario-secreto"
const PASSWORD = "clave-super-secreta"
const HOST = "db.interno.ejemplo"
const RAW_URL = `postgres://${USER}:${PASSWORD}@${HOST}:5432/medusa?sslmode=no-verify&ssl=false&sslpassword=clave-del-key&application_name=ramoide`

describe("sanitizeDatabaseUrl", () => {
  it("con sslmode=no-verify y DATABASE_CA_CERT deja rejectUnauthorized y ese CA", () => {
    const connection = resolveDatabaseConnection(
      {
        NODE_ENV: "production",
        DATABASE_URL: `postgres://${USER}:${PASSWORD}@${HOST}:5432/medusa?sslmode=no-verify`,
        DATABASE_CA_CERT: PEM,
        DATABASE_SSL: "require",
      },
      () => undefined
    )

    expect(connection.ssl).toEqual({
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
    })
    expect(connection.databaseUrl).toBe(
      `postgres://${USER}:${PASSWORD}@${HOST}:5432/medusa`
    )
    expect(connection.databaseUrl).not.toContain("sslmode")
  })

  it("mantiene parámetros que no son de TLS, como application_name", () => {
    const sanitized = sanitizeDatabaseUrl(
      `postgres://${USER}:${PASSWORD}@${HOST}:5432/medusa?application_name=ramoide&sslmode=require&options=-cstatement_timeout%3D5000`
    )

    expect(sanitized.removedTlsParameters).toEqual(["sslmode"])
    expect(sanitized.databaseUrl).toBe(
      `postgres://${USER}:${PASSWORD}@${HOST}:5432/medusa?application_name=ramoide&options=-cstatement_timeout%3D5000`
    )
  })

  it("quita ssl, sslpassword y el resto de parámetros TLS que lee pg", () => {
    const sanitized = sanitizeDatabaseUrl(RAW_URL)

    expect(sanitized.removedTlsParameters).toEqual([
      "sslmode",
      "ssl",
      "sslpassword",
    ])
    expect(sanitized.databaseUrl).toBe(
      `postgres://${USER}:${PASSWORD}@${HOST}:5432/medusa?application_name=ramoide`
    )
    expect(sanitized.databaseUrl).not.toContain("ssl=")
    expect(sanitized.databaseUrl).not.toContain("sslmode")
    expect(sanitized.databaseUrl).not.toContain("sslpassword")
  })

  it("la advertencia nombra los parámetros quitados y no incluye la URL, el usuario ni la contraseña", () => {
    const warn = jest.fn()

    resolveDatabaseConnection(
      {
        NODE_ENV: "production",
        DATABASE_URL: RAW_URL,
        DATABASE_SSL: "require",
      },
      warn
    )

    expect(warn).toHaveBeenCalledTimes(1)
    const message = warn.mock.calls[0][0] as string
    expect(message).toContain("Parámetros: sslmode, ssl, sslpassword.")
    expect(message).not.toContain(RAW_URL)
    expect(message).not.toContain(USER)
    expect(message).not.toContain(PASSWORD)
    expect(message).not.toContain(HOST)
    expect(message).not.toContain("clave-del-key")
    expect(message).not.toContain("no-verify")
  })

  it("PGSSLMODE=disable no pisa el objeto ssl", () => {
    const previous = process.env.PGSSLMODE
    process.env.PGSSLMODE = "disable"

    try {
      const warn = jest.fn()
      const connection = resolveDatabaseConnection(
        {
          NODE_ENV: "production",
          DATABASE_URL: `postgres://${USER}:${PASSWORD}@${HOST}:5432/medusa?ssl=0&ssl=false&sslmode=no-verify&sslpassword=clave-del-key&application_name=ramoide`,
          DATABASE_SSL: "require",
          DATABASE_CA_CERT: PEM,
        },
        warn
      )

      expect(connection.ssl).toEqual({
        rejectUnauthorized: true,
        ca: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
      })

      const ConnectionParameters = loadPgConnectionParameters()
      const client = new ConnectionParameters({
        connectionString: connection.databaseUrl,
        ssl: connection.ssl,
      })

      expect(client.ssl).toEqual({
        rejectUnauthorized: true,
        ca: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
      })
      expect(client.application_name).toBe("ramoide")
    } finally {
      if (previous === undefined) {
        delete process.env.PGSSLMODE
      } else {
        process.env.PGSSLMODE = previous
      }
    }
  })
})

function loadPgConnectionParameters(): new (config: {
  connectionString?: string
  ssl?: unknown
}) => { ssl: unknown; application_name?: string } {
  const requireFromMedusa = createRequire(require.resolve("@medusajs/medusa"))
  const postgresqlEntry = requireFromMedusa.resolve(
    "@medusajs/deps/mikro-orm/postgresql"
  )
  const requireFromDeps = createRequire(postgresqlEntry)
  const mikroEntry = requireFromDeps.resolve("@mikro-orm/postgresql")
  const requireFromMikro = createRequire(mikroEntry)
  return requireFromMikro("pg/lib/connection-parameters")
}

describe("productionSslDisabledWarning", () => {
  it("avisa en producción con DATABASE_SSL=false y no incluye la URL", () => {
    const message = productionSslDisabledWarning({
      NODE_ENV: "Production",
      DATABASE_SSL: "false",
      DATABASE_URL,
    })

    expect(message).toContain("ADVERTENCIA")
    expect(message).toContain("DATABASE_SSL=false")
    expect(message).not.toContain(DATABASE_URL)
    expect(message).not.toContain("NO-MOSTRAR-URL")
  })

  it("no avisa si el SSL queda encendido o no es producción", () => {
    expect(
      productionSslDisabledWarning({
        NODE_ENV: "production",
        DATABASE_URL,
      })
    ).toBeUndefined()
    expect(
      productionSslDisabledWarning({
        NODE_ENV: "development",
        DATABASE_SSL: "false",
        DATABASE_URL,
      })
    ).toBeUndefined()
  })

  it("escribe la advertencia sin lanzar", () => {
    const warn = jest.fn()

    expect(() =>
      warnIfProductionSslDisabled(
        {
          NODE_ENV: "prod",
          DATABASE_SSL: "false",
          DATABASE_URL,
        },
        warn
      )
    ).not.toThrow()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).not.toContain(DATABASE_URL)
  })
})
