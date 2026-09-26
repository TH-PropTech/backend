import { createHash } from 'node:crypto'
import type {
  ContractTemplateAnnexDefinition,
  ContractTemplateClause,
} from './contract-template.schema'

export const CONTRACT_TEMPLATE_SCHEMA_VERSION = 2

export type CanonicalLeaseBody = {
  legalProfile: string
  schemaVersion: number
  clauses: ContractTemplateClause[]
  annexDefinitions: ContractTemplateAnnexDefinition[]
  citationIds: string[]
}

export function canonicalizeTemplateBody(body: CanonicalLeaseBody): string {
  return JSON.stringify(sortCanonicalValue(body))
}

export function hashCanonicalTemplateBody(body: CanonicalLeaseBody): string {
  return createHash('sha256')
    .update(canonicalizeTemplateBody(body))
    .digest('hex')
}

export function normalizeTemplateClauses(
  clauses: ContractTemplateClause[]
): ContractTemplateClause[] {
  return clauses
    .map(clause => ({
      ...clause,
      id: clause.id ?? `article-${clause.number}`,
      number: clause.number,
      heading: clause.heading.trim(),
      ...(clause.content !== undefined
        ? { content: clause.content.trim() }
        : {}),
      variableRefs: [...(clause.variableRefs ?? [])].sort(),
      citationIds: [...clause.citationIds].sort(),
      protected: true,
      contentHash:
        clause.contentHash ||
        hashText(`${clause.heading.trim()}\n${clause.content?.trim() ?? ''}`),
    }))
    .sort((left, right) => left.number - right.number)
}

export function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function sortCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonicalValue)
  if (!isRecord(value)) return value
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortCanonicalValue(value[key])
      return result
    }, {})
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
