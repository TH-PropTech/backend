import { createHash } from 'node:crypto'
import type { LegalTermsSection } from './schemas/legal-terms-document.schema'

export interface CanonicalTermsInput {
  key: string
  version: number
  title: string
  summary: string
  sections: LegalTermsSection[]
}

export function computeCanonicalTermsHash(input: CanonicalTermsInput): string {
  const normalizedSections = [...(input.sections || [])]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(s => ({
      id: s.id.trim(),
      heading: s.heading.trim(),
      body: s.body.trim(),
      order: s.order,
    }))

  const canonicalPayload = JSON.stringify({
    key: input.key.trim(),
    version: input.version,
    title: input.title.trim(),
    summary: input.summary.trim(),
    sections: normalizedSections,
  })

  return createHash('sha256').update(canonicalPayload).digest('hex')
}
