import { Module } from "@medusajs/framework/utils"
import BtcpayClaimModuleService from "./service"

export const BTCPAY_CLAIM_MODULE = "btcpayClaim"

export default Module(BTCPAY_CLAIM_MODULE, {
  service: BtcpayClaimModuleService,
})
