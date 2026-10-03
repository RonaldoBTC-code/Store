import { databaseSsl, isLocalPostgresHost } from "../database-ssl"

describe("database SSL host check", () => {
  it("treats localhost as local and does not treat the postgres hostname as local", () => {
    expect(isLocalPostgresHost("localhost")).toBe(true)
    expect(isLocalPostgresHost("127.0.0.1")).toBe(true)
    expect(isLocalPostgresHost("::1")).toBe(true)
    expect(isLocalPostgresHost("postgres")).toBe(false)
    expect(databaseSsl("postgres://user:secret@localhost:5432/medusa")).toBe(false)
    expect(databaseSsl("postgres://user:secret@postgres:5432/medusa")).toEqual({
      rejectUnauthorized: true,
    })
  })
})
