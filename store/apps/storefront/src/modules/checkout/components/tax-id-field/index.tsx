import {
  TAX_ID_TYPES,
  type PublicTaxIdKind,
  type TaxIdType,
} from "@lib/util/ec-tax-id"
import Input from "@modules/common/components/input"
import NativeSelect from "@modules/common/components/native-select"
import { useState } from "react"

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
        <>
          <Input
            id="billing_address.company"
            label="Razón social"
            name="billing_address.company"
            autoComplete="organization"
            required
            maxLength={300}
            title="Ingresa la razón social para facturar con RUC"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            aria-describedby="billing-razon-social-help"
            data-testid="billing-razon-social-input"
          />
          <p
            id="billing-razon-social-help"
            data-testid="billing-razon-social-help"
          >
            Como aparece en tu RUC
          </p>
        </>
      ) : (
        <input type="hidden" name="billing_address.company" value="" />
      )}
    </div>
  )
}

export default TaxIdField
