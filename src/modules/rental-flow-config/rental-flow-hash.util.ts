import { createHash } from 'node:crypto'
import type { FlowProfileSteps } from './schemas/rental-flow-profile.schema'

export interface CanonicalFlowProfileInput {
  profileId: string
  name: string
  version: number
  steps: FlowProfileSteps
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    return value.trim()
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue)
  }
  if (typeof value === 'object') {
    const sortedObj: Record<string, unknown> = {}
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    for (const key of keys) {
      const val = obj[key]
      if (val !== undefined) {
        sortedObj[key] = canonicalizeValue(val)
      }
    }
    return sortedObj
  }
  return value
}

export function computeCanonicalFlowProfileHash(
  input: CanonicalFlowProfileInput
): string {
  const canonicalPayload = JSON.stringify({
    profileId: (input.profileId ?? '').trim(),
    name: (input.name ?? '').trim(),
    version: input.version,
    steps: canonicalizeValue(input.steps),
  })

  return createHash('sha256').update(canonicalPayload).digest('hex')
}
