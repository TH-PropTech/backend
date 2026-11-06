import type { UtilityRates } from '../../properties/utils/rental-package.util'

/** Đơn giá hiệu lực: phụ lục (nếu có) ghi đè giá trị chốt lúc tạo hợp đồng. */
export function resolveContractUtilityRates(contract: {
  utilityRates?: UtilityRates | null | undefined
  effectiveCommercial?:
    | { utilityRates?: UtilityRates | undefined }
    | null
    | undefined
}): UtilityRates | null {
  return (
    contract.effectiveCommercial?.utilityRates ?? contract.utilityRates ?? null
  )
}

/** Ghi chú cố định in trong biên bản nhận nhà và biên bản trả nhà. */
export const UTILITY_SETTLEMENT_NOTE =
  'Tiền dịch vụ và tiền điện, nước được tính vào lúc bàn giao lại nhà khi hết hợp đồng, theo chỉ số công tơ ghi trong Biên bản nhận nhà và Biên bản trả nhà.'

const vnd = (value: number): string => value.toLocaleString('vi-VN')

/** Một dòng mô tả đơn giá thỏa thuận; null khi hợp đồng không ghi đơn giá. */
export function describeUtilityRates(
  rates: UtilityRates | null | undefined
): string | null {
  if (!rates) return null
  const note = rates.note?.trim()
  return (
    `Đơn giá thỏa thuận: điện ${vnd(rates.electricityPerKwh)} đồng/kWh; ` +
    `nước ${vnd(rates.waterPerM3)} đồng/m³; ` +
    `phí dịch vụ ${vnd(rates.serviceFeeMonthly)} đồng/tháng.` +
    (note ? ` Ghi chú: ${note}` : '')
  )
}
