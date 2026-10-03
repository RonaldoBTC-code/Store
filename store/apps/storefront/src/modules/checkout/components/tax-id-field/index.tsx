import {
  TAX_ID_TYPES,
  type PublicTaxIdKind,
  type TaxIdType,
} from "@lib/util/ec-tax-id"
import Input from "@modules/common/components/input"
import NativeSelect from "@modules/common/components/native-select"
import { Label } from "@modules/common/components/ui"
import { useState } from "react"

const RAZON_SOCIAL_ERROR = "Ingresa la razón social para facturar con RUC"

const TAX_ID_LABELS: Record<TaxIdType, string> = {
  cedula: "Cédula",
  ruc: "RUC",
  consumidor_final: "Consumidor final",
}

const TaxIdField = ({
  taxIdSet,
  taxIdKind,
  requireReentry,
}: {
  taxIdSet: boolean
  taxIdKind: PublicTaxIdKind | null
  requireReentry: boolean
}) => {
  const [editing, setEditing] = useState(false)
  const [taxIdType, setTaxIdType] = useState<TaxIdType>(
    taxIdKind === "consumidor_final" ? "consumidor_final" : "cedula"
  )
  const [taxId, setTaxId] = useState("")
  const [company, setCompany] = useState("")
  const [companyInvalid, setCompanyInvalid] = useState(false)
  const showSaved = taxIdSet && !editing
  const needsNumber = !showSaved && taxIdType !== "consumidor_final"
  const showReentryHint = needsNumber && (editing || requireReentry)
  const describedBy = [
    "billing-tax-id-help",
    showReentryHint ? "billing-tax-id-reenter-hint" : "",
  ]
    .filter(Boolean)
    .join(" ")

  if (showSaved) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <p data-testid="billing-tax-id-entered">
          {taxIdKind === "consumidor_final"
            ? "Consumidor final"
            : "Cédula ingresada"}
        </p>
        <button
          type="button"
          className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover w-fit"
          data-testid="billing-tax-id-change"
          onClick={() => {
            setEditing(true)
            setTaxId("")
            setCompany("")
            setCompanyInvalid(false)
            setTaxIdType(
              taxIdKind === "consumidor_final" ? "consumidor_final" : "cedula"
            )
          }}
        >
          Cambiar
        </button>
        <input type="hidden" name="billing_address.tax_id_keep" value="on" />
        {taxIdKind === "consumidor_final" && (
          <input type="hidden" name="billing_address.company" value="" />
        )}
      </div>
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <NativeSelect
        placeholder="ID type"
        name="billing_address.tax_id_type"
        defaultValue={taxIdType}
        onChange={(event) => {
          const next = event.target.value
          if ((TAX_ID_TYPES as readonly string[]).includes(next)) {
            setTaxIdType(next as TaxIdType)
            setTaxId("")
            setCompany("")
            setCompanyInvalid(false)
          }
        }}
        required
        data-testid="billing-tax-id-type"
      >
        {TAX_ID_TYPES.map((type) => (
          <option key={type} value={type}>
            {TAX_ID_LABELS[type]}
          </option>
        ))}
      </NativeSelect>
      {needsNumber ? (
        <>
          <Input
            id="billing_address.tax_id"
            label={taxIdType === "ruc" ? "RUC" : "Cédula"}
            name="billing_address.tax_id"
            autoComplete="off"
            inputMode="numeric"
            pattern={taxIdType === "ruc" ? "[0-9]{13}" : "[0-9]{10}"}
            minLength={taxIdType === "ruc" ? 13 : 10}
            maxLength={taxIdType === "ruc" ? 13 : 10}
            title={
              taxIdType === "ruc"
                ? "El RUC no es válido. Revisa que tenga 13 dígitos."
                : "La cédula no es válida. Revisa que tenga 10 dígitos."
            }
            value={taxId}
            onChange={(event) => setTaxId(event.target.value)}
            required
            aria-describedby={describedBy}
            data-testid="billing-tax-id-input"
          />
          <p id="billing-tax-id-help" data-testid="billing-tax-id-help">
            {taxIdType === "ruc"
              ? "13 dígitos, sin guiones."
              : "10 dígitos, sin guiones."}
          </p>
        </>
      ) : (
        <p id="billing-tax-id-help" data-testid="billing-tax-id-help">
          Consumidor final no requiere número.
        </p>
      )}
      {showReentryHint && (
        <p
          id="billing-tax-id-reenter-hint"
          data-testid="billing-tax-id-reenter-hint"
        >
          Por seguridad, vuelve a escribir tu cédula
        </p>
      )}
      {taxIdType === "ruc" ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="billing_address.company">
            Razón social
            <span className="text-rose-500">*</span>
          </Label>
          <input
            id="billing_address.company"
            name="billing_address.company"
            autoComplete="organization"
            required
            maxLength={300}
            value={company}
            aria-invalid={companyInvalid}
            aria-describedby={
              companyInvalid
                ? "billing-razon-social-help billing-razon-social-error"
                : "billing-razon-social-help"
            }
            data-testid="billing-razon-social-input"
            className="pt-4 pb-1 block w-full h-11 px-4 mt-0 bg-ui-bg-field border rounded-md appearance-none focus:outline-none focus:ring-0 focus:shadow-borders-interactive-with-active border-ui-border-base hover:bg-ui-bg-field-hover"
            onChange={(event) => {
              const next = event.target.value
              setCompany(next)
              if (next.trim()) {
                setCompanyInvalid(false)
              }
            }}
            onBlur={() => {
              if (!company.trim()) {
                setCompanyInvalid(true)
              }
            }}
            onInvalid={(event) => {
              event.preventDefault()
              setCompanyInvalid(true)
            }}
          />
          <p
            id="billing-razon-social-help"
            data-testid="billing-razon-social-help"
          >
            Como aparece en tu RUC
          </p>
          {companyInvalid && (
            <p
              id="billing-razon-social-error"
              data-testid="billing-razon-social-error"
            >
              {RAZON_SOCIAL_ERROR}
            </p>
          )}
        </div>
      ) : (
        <input type="hidden" name="billing_address.company" value="" />
      )}
    </div>
  )
}

export default TaxIdField
