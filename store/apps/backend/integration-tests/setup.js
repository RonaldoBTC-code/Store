if (process.env.DB_HOST === "127.0.0.1") {
  process.env.DB_HOST = "localhost"
}

function payphoneTestsRejectRealFetch() {
  throw new Error(
    "Real fetch is not allowed in tests. PayPhone tests must inject a fetch double."
  )
}

global.fetch = payphoneTestsRejectRealFetch
globalThis.fetch = payphoneTestsRejectRealFetch

const { MetadataStorage } = require("@medusajs/framework/mikro-orm/core")

MetadataStorage.clear()
