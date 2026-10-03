import { PAYPHONE_CONFIRMING_COPY } from "@lib/payphone-return"

export default function PayphoneReturnLoading() {
  return (
    <div className="content-container py-16">
      <p className="text-xl" data-testid="payphone-confirming">
        {PAYPHONE_CONFIRMING_COPY}
      </p>
    </div>
  )
}
