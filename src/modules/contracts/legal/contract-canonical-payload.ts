import { createHash } from 'node:crypto'
import type {
  Contract,
  ContractCommercialDraft,
} from '../schemas/contract.schema'
import type { ContractTemplate } from './contract-template.schema'
import { canonicalizeTipTapContent } from './tiptap-content'

export const CONTRACT_CONTENT_HASH_SCHEMA_VERSION = 2

export type ContractCanonicalPayload = {
  hashSchemaVersion: number
  contractId: string | null
  contractCode: string
  templateRef: Contract['contractTemplateRef']
  legalProfile: string | null
  clauses: Array<{
    id: string
    number: number
    heading: string
    content: string | null
    contentHash: string
    citationIds: string[]
  }>
  annexDefinitions: NonNullable<ContractTemplate['annexDefinitions']>
  citationIds: string[]
  commercial: ContractCommercialDraft
  parties: {
    tenantId: string
    landlordId: string
  }
  property: {
    propertyId: string
    title: string
    address: string | null
    area: number | null
    furniture: string | null
  }
  dates: {
    startDate: string
    endDate: string
  }
  addendaIds: string[]
  amendmentId: string | null
}

export function buildCanonicalContractPayload(
  contract: Contract,
  template?: Pick<
    ContractTemplate,
    | 'legalProfile'
    | 'schemaVersion'
    | 'clauses'
    | 'annexDefinitions'
    | 'citationIds'
  >,
  amendmentId: string | null = null
): ContractCanonicalPayload {
  const editorContent = contract.editorContent
    ? canonicalizeTipTapContent(contract.editorContent)
    : null
  const commercial = contract.commercialDraft ?? {
    monthlyRent: contract.monthlyRent,
    deposit: contract.deposit,
    paymentDay: contract.paymentDay,
    latePenaltyRate: contract.latePenaltyRate,
    terminationNoticeDays: contract.terminationNoticeDays,
    durationMonths: contract.durationMonths ?? 12,
  }
  const clauses = (template?.clauses ?? []).map(clause => ({
    id: clause.id ?? `article-${clause.number}`,
    number: clause.number,
    heading: clause.heading,
    content: clause.content ?? editorContent,
    contentHash: clause.contentHash,
    citationIds: [...clause.citationIds].sort(),
  }))
  return {
    hashSchemaVersion: CONTRACT_CONTENT_HASH_SCHEMA_VERSION,
    contractId: contract._id?.toHexString() ?? null,
    contractCode: contract.contractCode,
    templateRef:
      contract.contractTemplateRef ??
      (contract.termsRef?.key.startsWith('VN_') ? contract.termsRef : null),
    legalProfile:
      template?.legalProfile ?? contract.flowProfileRef?.profileId ?? null,
    clauses,
    annexDefinitions: template?.annexDefinitions ?? [],
    citationIds: [...(template?.citationIds ?? [])].sort(),
    commercial,
    parties: {
      tenantId: contract.tenantId,
      landlordId: contract.landlordId,
    },
    property: {
      propertyId: contract.propertyId,
      title: contract.propertyTitle,
      address: contract.propertyAddress,
      area: contract.propertyArea,
      furniture: contract.propertyFurniture,
    },
    dates: {
      startDate: new Date(contract.startDate).toISOString(),
      endDate: new Date(contract.endDate).toISOString(),
    },
    addendaIds: [...(commercial.addendaIds ?? [])].sort(),
    amendmentId,
  }
}

export function canonicalizeContractPayload(
  payload: ContractCanonicalPayload
): string {
  return JSON.stringify(sortValue(payload))
}

export function hashCanonicalContractPayload(
  payload: ContractCanonicalPayload
): string {
  return createHash('sha256')
    .update(canonicalizeContractPayload(payload))
    .digest('hex')
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!isRecord(value)) return value
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortValue(value[key])
      return result
    }, {})
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
