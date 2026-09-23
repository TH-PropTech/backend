import { getMetadataArgsStorage } from 'typeorm'
import { ContractArtifact } from './schemas/contract-artifact.schema'
import { ContractTemplate } from './legal/contract-template.schema'
import { SmartCaSigningSession } from './smartca/smartca-signing-session.schema'

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
    expect(getIndexColumns(ContractArtifact)).toContainEqual([
      'contractId',
      'revision',
    ])
    expect(getIndexColumns(ContractTemplate)).toContainEqual([
      'templateKey',
      'version',
    ])
  })

  it('indexes signing sessions by participant and canonical artifact state', () => {
    expect(getIndexColumns(SmartCaSigningSession)).toContainEqual([
      'contractId',
      'signerId',
      'artifactHash',
      'status',
    ])
  })

  it('persists lock and certificate evidence metadata as nullable fields', () => {
    expect(getColumnNames(ContractArtifact)).toContain('lockedAt')
    expect(getColumnNames(SmartCaSigningSession)).toEqual(
      expect.arrayContaining(['signatureAlgorithm', 'signatureValueRef'])
    )
  })
})
