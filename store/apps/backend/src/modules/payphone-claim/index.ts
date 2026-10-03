import { Module } from "@medusajs/framework/utils"
import PayphoneClaimModuleService from "./service"

export const PAYPHONE_CLAIM_MODULE = "payphoneClaim"

export default Module(PAYPHONE_CLAIM_MODULE, {
  service: PayphoneClaimModuleService,
})
