import {
  productionSslDisabledWarning,
  resolveDatabaseSsl,
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

  it("rechaza un valor desconocido de DATABASE_SSL", () => {
    expect(() =>
      resolveDatabaseSsl({
        DATABASE_SSL: "maybe",
      })
    ).toThrow(/DATABASE_SSL/)
  })
})

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
