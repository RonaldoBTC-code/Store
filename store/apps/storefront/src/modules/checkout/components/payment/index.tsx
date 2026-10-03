"use client"
import { RadioGroup } from "@headlessui/react"
import {
  isPayphone,
  isStripeLike,
  payphoneStatusMessage,
  paymentInfoMap,
} from "@lib/constants"
import {
  PAYPHONE_BUTTON_LABEL,
  PAYPHONE_LEAVING_COPY,
  PAYPHONE_NO_CHARGE_COPY,
  PAYPHONE_RETRY_LABEL,
  showsNoCharge,
} from "@lib/payphone-return"
import { initiatePaymentSession } from "@lib/data/cart"
import { CheckCircleSolid, CreditCard } from "@medusajs/icons"
import ErrorMessage from "@modules/checkout/components/error-message"
import PaymentContainer, {
  StripePaymentContainer,
} from "@modules/checkout/components/payment-container"
import Divider from "@modules/common/components/divider"
import {
  Button,
  Container,
  Heading,
  Text,
  clx,
} from "@modules/common/components/ui"
import { HttpTypes } from "@medusajs/types"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

const Payment = ({
  cart,
  availablePaymentMethods,
}: {
  cart: HttpTypes.StoreCart
  availablePaymentMethods: { id: string }[]
}) => {
  const activeSession = cart.payment_collection?.payment_sessions?.find(
    (paymentSession) => paymentSession.status === "pending"
  )

  const [isLoading, setIsLoading] = useState(false)
  const [departing, setDeparting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paymentComplete, setPaymentComplete] = useState(false)
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(
    activeSession?.provider_id ?? ""
  )

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const isOpen = searchParams.get("step") === "payment"
  const payphoneCode = searchParams.get("payphone")
  const showNoCharge = showsNoCharge(payphoneCode)
  const payphoneMessage = showNoCharge
    ? null
    : payphoneStatusMessage(payphoneCode) ??
      payphoneStatusMessage(searchParams.get("payphone_status"))

  const setPaymentMethod = async (method: string) => {
    setError(null)
    setSelectedPaymentMethod(method)
    if (isStripeLike(method)) {
      await initiatePaymentSession(cart, {
        provider_id: method,
      })
    }
  }

  const paidByGiftcard = !!(
    (cart as unknown as Record<string, unknown>)?.gift_cards && ((cart as unknown as Record<string, unknown>)?.gift_cards as unknown[])?.length > 0 && cart?.total === 0
  )

  const paymentReady =
    (activeSession && (cart?.shipping_methods?.length ?? 0) !== 0) || paidByGiftcard

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams)
      params.set(name, value)

      return params.toString()
    },
    [searchParams]
  )

  const handleEdit = () => {
    router.push(pathname + "?" + createQueryString("step", "payment"), {
      scroll: false,
    })
  }

  const handlePayphone = async () => {
    if (departing || isLoading) {
      return
    }

    setIsLoading(true)
    setError(null)
    let leaving = false

    try {
      const collection = await initiatePaymentSession(cart, {
        provider_id: selectedPaymentMethod,
      })
      const session = collection?.payment_collection?.payment_sessions?.find(
        (paymentSession) => paymentSession.provider_id === selectedPaymentMethod
      )
      const payWithCard = session?.data?.pay_with_card

      if (typeof payWithCard !== "string" || !payWithCard) {
        setError("No pudimos iniciar el pago con PayPhone. Intenta de nuevo.")
        return
      }

      let target: URL
      try {
        target = new URL(payWithCard)
      } catch {
        setError("No pudimos iniciar el pago con PayPhone. Intenta de nuevo.")
        return
      }

      if (
        target.protocol !== "https:" ||
        target.hostname !== "pay.payphonetodoesposible.com" ||
        target.username !== "" ||
        target.password !== "" ||
        target.port !== ""
      ) {
        setError("No pudimos iniciar el pago con PayPhone. Intenta de nuevo.")
        return
      }

      leaving = true
      setDeparting(true)
      window.location.assign(target.toString())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!leaving) {
        setIsLoading(false)
      }
    }
  }

  const handleSubmit = async () => {
    if (isPayphone(selectedPaymentMethod)) {
      await handlePayphone()
      return
    }

    setIsLoading(true)
    try {
      const shouldInputPaymentDetails =
        isStripeLike(selectedPaymentMethod) && !activeSession

      const checkActiveSession =
        activeSession?.provider_id === selectedPaymentMethod

      if (!checkActiveSession) {
        await initiatePaymentSession(cart, {
          provider_id: selectedPaymentMethod,
        })
      }

      if (!shouldInputPaymentDetails) {
        return router.push(
          pathname + "?" + createQueryString("step", "review"),
          {
            scroll: false,
          }
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    setError(null)
  }, [isOpen])

  return (
    <div className="bg-ink-950 text-white">
      <div className="flex flex-row items-center justify-between mb-6">
        <Heading
          level="h2"
          className={clx(
            "flex flex-row text-3xl-regular gap-x-2 items-baseline",
            {
              "opacity-50 pointer-events-none select-none":
                !isOpen && !paymentReady,
            }
          )}
        >
          Payment
          {!isOpen && paymentReady && <CheckCircleSolid />}
        </Heading>
        {!isOpen && paymentReady && (
          <Text>
            <button
              onClick={handleEdit}
              className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover"
              data-testid="edit-payment-button"
            >
              Edit
            </button>
          </Text>
        )}
      </div>
      <div>
        {showNoCharge && (
          <div className="mb-4">
            <Text
              className="text-rose-400 mb-4"
              data-testid="payphone-payment-error"
            >
              {PAYPHONE_NO_CHARGE_COPY}
            </Text>
            <Button
              type="button"
              variant="secondary"
              data-testid="payphone-retry"
              onClick={() => {
                const params = new URLSearchParams(searchParams)
                params.delete("payphone")
                params.set("step", "payment")
                router.push(`${pathname}?${params.toString()}`, { scroll: false })
              }}
            >
              {PAYPHONE_RETRY_LABEL}
            </Button>
          </div>
        )}
        {payphoneMessage && (
          <Text
            className="text-rose-400 mb-4"
            data-testid="payphone-payment-error"
          >
            {payphoneMessage}
          </Text>
        )}
        <div className={isOpen ? "block" : "hidden"}>
          {!paidByGiftcard && availablePaymentMethods?.length && (
            <>
              <RadioGroup
                value={selectedPaymentMethod}
                onChange={(value: string) => setPaymentMethod(value)}
              >
                {availablePaymentMethods.map((paymentMethod) => (
                  <div key={paymentMethod.id}>
                    {isStripeLike(paymentMethod.id) ? (
                      <StripePaymentContainer
                        paymentProviderId={paymentMethod.id}
                        selectedPaymentOptionId={selectedPaymentMethod}
                        paymentInfoMap={paymentInfoMap}
                        setError={setError}
                        setPaymentComplete={setPaymentComplete}
                      />
                    ) : (
                      <PaymentContainer
                        paymentInfoMap={paymentInfoMap}
                        paymentProviderId={paymentMethod.id}
                        selectedPaymentOptionId={selectedPaymentMethod}
                      />
                    )}
                  </div>
                ))}
              </RadioGroup>
            </>
          )}

          {paidByGiftcard && (
            <div className="flex flex-col w-1/3">
              <Text className="txt-medium-plus text-ui-fg-base mb-1">
                Payment method
              </Text>
              <Text
                className="txt-medium text-ui-fg-subtle"
                data-testid="payment-method-summary"
              >
                Gift card
              </Text>
            </div>
          )}

          <ErrorMessage
            error={error}
            data-testid="payment-method-error-message"
          />

          <Button
            size="large"
            className="mt-6"
            onClick={handleSubmit}
            isLoading={isLoading || departing}
            disabled={
              departing ||
              (isStripeLike(selectedPaymentMethod) && !paymentComplete) ||
              (!selectedPaymentMethod && !paidByGiftcard)
            }
            data-testid="submit-payment-button"
          >
            {isPayphone(selectedPaymentMethod) ? (
              <span data-testid="payphone-payment-button">{PAYPHONE_BUTTON_LABEL}</span>
            ) : !activeSession && isStripeLike(selectedPaymentMethod) ? (
              "Enter payment details"
            ) : (
              "Continue to review"
            )}
          </Button>
          {isPayphone(selectedPaymentMethod) && (
            <Text
              className="txt-medium text-ui-fg-subtle mt-6"
              data-testid="payphone-payment-waiting"
            >
              {PAYPHONE_LEAVING_COPY}
            </Text>
          )}
        </div>

        <div className={isOpen ? "hidden" : "block"}>
          {cart && paymentReady && activeSession ? (
            <div className="flex items-start gap-x-1 w-full">
              <div className="flex flex-col w-1/3">
                <Text className="txt-medium-plus text-ui-fg-base mb-1">
                  Payment method
                </Text>
                <Text
                  className="txt-medium text-ui-fg-subtle"
                  data-testid="payment-method-summary"
                >
                  {paymentInfoMap[activeSession?.provider_id]?.title ||
                    activeSession?.provider_id}
                </Text>
              </div>
              <div className="flex flex-col w-1/3">
                <Text className="txt-medium-plus text-ui-fg-base mb-1">
                  Payment details
                </Text>
                <div
                  className="flex gap-2 txt-medium text-ui-fg-subtle items-center"
                  data-testid="payment-details-summary"
                >
                  <Container className="flex items-center h-7 w-fit p-2 bg-ui-button-neutral-hover">
                    {paymentInfoMap[selectedPaymentMethod]?.icon || (
                      <CreditCard />
                    )}
                  </Container>
                  <Text>Another step will appear</Text>
                </div>
              </div>
            </div>
          ) : paidByGiftcard ? (
            <div className="flex flex-col w-1/3">
              <Text className="txt-medium-plus text-ui-fg-base mb-1">
                Payment method
              </Text>
              <Text
                className="txt-medium text-ui-fg-subtle"
                data-testid="payment-method-summary"
              >
                Gift card
              </Text>
            </div>
          ) : null}
        </div>
      </div>
      <Divider className="mt-8" />
    </div>
  )
}

export default Payment
