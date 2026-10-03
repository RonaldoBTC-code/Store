import { resolveDatabaseSsl } from "../database-ssl"

const PEM = "-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----"

describe("resolveDatabaseSsl", () => {
  it("apaga SSL en local cuando DATABASE_SSL no está definida", () => {
    expect(resolveDatabaseSsl({ NODE_ENV: "development" })).toBe(false)
    expect(resolveDatabaseSsl({})).toBe(false)
    expect(resolveDatabaseSsl({ NODE_ENV: "test" })).toBe(false)
  })

  it("apaga SSL en CI aunque NODE_ENV sea production", () => {
    expect(
      resolveDatabaseSsl({
        NODE_ENV: "production",
        CI: "true",
      })
    ).toBe(false)
  })

  it("enciende SSL con verificación en producción fuera de CI", () => {
    expect(
      resolveDatabaseSsl({
        NODE_ENV: "production",
      })
    ).toEqual({ rejectUnauthorized: true })
  })

  it("DATABASE_SSL=false gana incluso en producción", () => {
    expect(
      resolveDatabaseSsl({
        NODE_ENV: "production",
        DATABASE_SSL: "false",
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
    const readCaFile = jest.fn().mockReturnValue("-----BEGIN CERTIFICATE-----\nFILE\n-----END CERTIFICATE-----\n")

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
