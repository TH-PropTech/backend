import { getMetadataArgsStorage } from 'typeorm'
import { Contract } from './contract.schema'
import { ContractDocument } from './contract-document.schema'
import {
  CONTRACT_DOCUMENT_CANONICAL_UNIQUE_INDEX,
  CONTRACT_DOCUMENT_KIND_REVISION_INDEX,
} from './contract-document.schema'
import { ContractTemplate } from './contract-template.schema'
import { CONTRACT_TEMPLATE_TEMPLATE_UNIQUE_INDEX } from '../../../data/migrations/025-contract-layout-profiles-merge'
import { SmartCaSigningSession } from './smartca-signing-session.schema'

type MetadataTarget = string | (new (...args: never[]) => object)

function getIndexColumns(target: MetadataTarget): string[][] {
  return getMetadataArgsStorage()
    .indices.filter(index => index.target === target)
    .map(index => index.columns)
    .filter((columns): columns is string[] => Array.isArray(columns))
}

function getColumnNames(target: MetadataTarget): string[] {
  return getMetadataArgsStorage()
    .columns.filter(column => column.target === target)
    .map(column =>
      typeof column.propertyName === 'string' ? column.propertyName : ''
    )
    .filter(Boolean)
}

describe('contract persistence schema', () => {
  it('keeps immutable artifact and template revision indexes', () => {
    expect(getIndexColumns(ContractDocument)).toContainEqual([
      'kind',
      'contractId',
      'revision',
    ])
    // G-LAY: (templateKey, version) là UNIQUE PARTIAL theo kind, do migration 025 tạo.
    // Entity không khai báo lại bộ khóa đó (Mongo từ chối hai chỉ mục cùng khóa khác tên).
    expect(getIndexColumns(ContractTemplate)).not.toContainEqual([
      'templateKey',
      'version',
    ])
    expect(CONTRACT_TEMPLATE_TEMPLATE_UNIQUE_INDEX.keys).toEqual({
      templateKey: 1,
      version: 1,
    })
    expect(CONTRACT_TEMPLATE_TEMPLATE_UNIQUE_INDEX.options).toEqual({
      unique: true,
      partialFilterExpression: { kind: 'template' },
    })
  })

  it('does not declare a non-partial unique index on contract documents (signed rows must not clash)', () => {
    const unique = getMetadataArgsStorage().indices.filter(
      index => index.target === ContractDocument && index.unique
    )
    expect(unique).toHaveLength(0)
  })

  it('keeps the canonical-only partial unique index for (contractId, revision, amendmentId) and the per-kind index for migration 011', () => {
    expect(CONTRACT_DOCUMENT_CANONICAL_UNIQUE_INDEX.keys).toEqual({
      contractId: 1,
      revision: 1,
      amendmentId: 1,
    })
    expect(CONTRACT_DOCUMENT_CANONICAL_UNIQUE_INDEX.options).toEqual({
      unique: true,
      partialFilterExpression: { kind: 'canonical' },
    })
    expect(CONTRACT_DOCUMENT_KIND_REVISION_INDEX.keys).toEqual({
      kind: 1,
      contractId: 1,
      revision: 1,
    })
  })

  it('indexes signing sessions by kind, participant and canonical artifact state', () => {
    expect(getIndexColumns(SmartCaSigningSession)).toContainEqual([
      'kind',
      'contractId',
      'signerId',
      'artifactHash',
      'status',
    ])
  })

  it('persists lock and certificate evidence metadata as nullable fields', () => {
    expect(getColumnNames(ContractDocument)).toContain('lockedAt')
    expect(getColumnNames(SmartCaSigningSession)).toEqual(
      expect.arrayContaining(['signatureAlgorithm', 'signatureValueRef'])
    )
  })

  it('persists an optional, immutable governance snapshot reference on contracts (PROP-399)', () => {
    expect(getColumnNames(Contract)).toContain('governanceSnapshotRef')
    const contract = new Contract()
    expect(contract.governanceSnapshotRef).toBeUndefined()
    contract.governanceSnapshotRef = {
      snapshotId: 'snap-1',
      version: 1,
      manifestHash: 'a'.repeat(64),
    }
    expect(contract.governanceSnapshotRef.snapshotId).toBe('snap-1')
  })
})
