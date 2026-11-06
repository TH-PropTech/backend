import {
  validateUtilityRates,
  type UtilityRates,
} from '../../properties/utils/rental-package.util'
import type { ContractOccupant } from '../schemas/contract.schema'

const MAX_OCCUPANTS = 20
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isNonEmptyText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max

function isOccupant(value: unknown): value is ContractOccupant {
  return (
    isRecord(value) &&
    isNonEmptyText(value.fullName, 100) &&
    typeof value.birthYear === 'number' &&
    Number.isInteger(value.birthYear) &&
    value.birthYear >= 1900 &&
    value.birthYear <= 2100 &&
    isNonEmptyText(value.relationship, 50)
  )
}

export function isValidOccupantList(
  value: unknown
): value is ContractOccupant[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_OCCUPANTS &&
    value.every(isOccupant)
  )
}

export function isValidUtilityRates(value: unknown): value is UtilityRates {
  if (!isRecord(value)) return false
  const { electricityPerKwh, waterPerM3, serviceFeeMonthly, note } = value
  if (note !== undefined && typeof note !== 'string') return false
  return (
    validateUtilityRates({
      electricityPerKwh: electricityPerKwh as number,
      waterPerM3: waterPerM3 as number,
      serviceFeeMonthly: serviceFeeMonthly as number,
      ...(note !== undefined ? { note } : {}),
    }) === null
  )
}
