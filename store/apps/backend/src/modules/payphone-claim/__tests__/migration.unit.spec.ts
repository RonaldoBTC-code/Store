import { Migration20261003180000 } from "../migrations/Migration20261003180000"

describe("payphone_claim transaction id migration", () => {
  it("drops the unique constraint on the way down", async () => {
    const migration = new Migration20261003180000({} as never, {} as never)

    await migration.down()

    expect(
      migration
        .getQueries()
        .map((query) => String(query))
        .join("\n")
        .toLowerCase()
    ).toContain('drop constraint if exists "payphone_claim_transaction_id_key"')
  })
})
