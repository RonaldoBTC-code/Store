import { EllipseMiniSolid } from "@medusajs/icons"
import { Label, RadioGroup, Text, clx } from "@modules/common/components/ui"
type FilterRadioGroupProps = {
  title: string
  items: {
    value: string
    label: string
  }[]
  value: string
  handleChange: (value: string) => void
  "data-testid"?: string
}

const FilterRadioGroup = ({
  title,
  items,
  value,
  handleChange,
  "data-testid": dataTestId,
}: FilterRadioGroupProps) => {
  return (
    <div className="flex flex-col gap-x-3 gap-y-3">
      <Text className="txt-compact-small-plus text-white/45">{title}</Text>
      <RadioGroup data-testid={dataTestId}>
        {items?.map((i) => (
          <div
            key={i.value}
            role="button"
            tabIndex={0}
            onClick={() => handleChange(i.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                handleChange(i.value)
              }
            }}
            className={clx(
              "flex cursor-pointer items-center gap-x-2 text-left text-white/70 hover:text-white",
              {
                "ml-[-23px] text-white": i.value === value,
              }
            )}
          >
            {i.value === value && <EllipseMiniSolid />}
            <RadioGroup.Item
              checked={i.value === value}
              onChange={() => handleChange(i.value)}
              className="sr-only"
              id={i.value}
              value={i.value}
            />
            <Label
              htmlFor={i.value}
              className="pointer-events-none !txt-compact-small !transform-none"
              data-testid="radio-label"
              data-active={i.value === value}
            >
              {i.label}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  )
}

export default FilterRadioGroup
