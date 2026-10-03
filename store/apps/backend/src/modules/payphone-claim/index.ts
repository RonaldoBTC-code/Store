import { Module } from "@medusajs/framework/utils"
import warnTestPaymentsLoader from "./loaders/warn-test-payments"
import PayphoneClaimModuleService from "./service"

export const PAYPHONE_CLAIM_MODULE = "payphoneClaim"

export default Module(PAYPHONE_CLAIM_MODULE, {
  service: PayphoneClaimModuleService,
  loaders: [warnTestPaymentsLoader],
})
