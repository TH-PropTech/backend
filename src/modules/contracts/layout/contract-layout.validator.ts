import {
  CONTRACT_LAYOUT_BLOCK_IDS,
  LAYOUT_FIELD_KEYS,
  type ContractLayoutBlock,
  type ContractLayoutSupplementaryClause,
} from '../schemas/contract-layout-profile.schema'

const REQUIRED_BLOCKS = new Set([
  'PARTIES',
  'PROPERTY',
  'COMMERCIAL_TERMS',
  'LEGAL_ARTICLES',
  'SIGNATURES',
])
const MAX_SUPPLEMENTARY_CLAUSES = 10
const MAX_CLAUSE_LENGTH = 4_000

export function validateContractLayout(
  blocks: readonly ContractLayoutBlock[],
  supplementaryClauses: readonly ContractLayoutSupplementaryClause[]
): true {
  if (
    blocks.some(block => !CONTRACT_LAYOUT_BLOCK_IDS.includes(block.blockId))
  ) {
    throw new Error('CONTRACT_LAYOUT_BLOCK_NOT_ALLOWED')
  }
  if (
    [...REQUIRED_BLOCKS].some(
      blockId =>
        !blocks.some(block => block.blockId === blockId && block.visible)
    )
  ) {
    throw new Error('CONTRACT_LAYOUT_REQUIRED_BLOCK_HIDDEN')
  }
  if (
    blocks.some(
      block =>
        !block.title.trim() ||
        block.fields?.some(
          field =>
            !LAYOUT_FIELD_KEYS.includes(field.fieldKey) || !field.label.trim()
        )
    )
  ) {
    throw new Error('CONTRACT_LAYOUT_FIELD_NOT_ALLOWED')
  }
  if (
    supplementaryClauses.length > MAX_SUPPLEMENTARY_CLAUSES ||
    supplementaryClauses.some(
      clause =>
        !clause.id.trim() ||
        !clause.title.trim() ||
        clause.content.length > MAX_CLAUSE_LENGTH ||
        /<script\b/i.test(clause.content)
    )
  ) {
    throw new Error('CONTRACT_LAYOUT_SUPPLEMENTARY_CLAUSE_INVALID')
  }
  return true
}

export function assertProtectedLegalContentUnchanged(
  replacement: unknown
): void {
  if (replacement !== undefined && replacement !== null) {
    throw new Error('CONTRACT_LAYOUT_PROTECTED_CONTENT')
  }
}
