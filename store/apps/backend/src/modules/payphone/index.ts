import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PayphoneProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [PayphoneProviderService],
})
