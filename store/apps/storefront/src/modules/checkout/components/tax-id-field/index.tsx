import { TAX_ID_TYPES, type TaxIdType } from "@lib/util/ec-tax-id"
import Input from "@modules/common/components/input"
import NativeSelect from "@modules/common/components/native-select"
import { useState } from "react"

const TAX_ID_LABELS: Record<TaxIdType, string> = {
  cedula: "Cédula",
  ruc: "RUC",
  consumidor_final: "Consumidor final",
}

const TaxIdField = ({
  defaultType,
  defaultTaxId,
}: {
  defaultType: TaxIdType
  defaultTaxId: string
}) => {
  const [taxIdType, setTaxIdType] = useState<TaxIdType>(defaultType)
  const [taxId, setTaxId] = useState(defaultTaxId)
  const needsNumber = taxIdType !== "consumidor_final"

  return (
    <div className="mt-4 flex flex-col gap-4">
      <NativeSelect
        placeholder="ID type"
        name="billing_address.tax_id_type"
        defaultValue={defaultType}
        onChange={(event) => {
          const next = event.target.value
          if ((TAX_ID_TYPES as readonly string[]).includes(next)) {
            setTaxIdType(next as TaxIdType)
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
      {needsNumber && (
        <Input
          label={taxIdType === "ruc" ? "RUC" : "Cédula"}
          name="billing_address.tax_id"
          autoComplete="off"
          inputMode="numeric"
          pattern={taxIdType === "ruc" ? "[0-9]{13}" : "[0-9]{10}"}
          minLength={taxIdType === "ruc" ? 13 : 10}
          maxLength={taxIdType === "ruc" ? 13 : 10}
          title={
            taxIdType === "ruc"
              ? "Enter the 13-digit RUC."
              : "Enter the 10-digit cédula."
          }
          value={taxId}
          onChange={(event) => setTaxId(event.target.value)}
          required
          data-testid="billing-tax-id-input"
        />
      )}
    </div>
  )
}

export default TaxIdField
