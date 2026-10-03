import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ObjectId } from 'mongodb'
import {
  GovernanceSnapshotIdParamDto,
  GovernanceSnapshotListQueryDto,
  GovernanceSnapshotResponseDto,
  GovernanceVerificationResponseDto,
} from './fabric-governance.dto'
import { FabricGovernanceSnapshot } from '../schemas/fabric-governance-snapshot.schema'

async function errorsOf<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>
): Promise<string[]> {
  const instance = plainToInstance(cls, plain)
  const errors = await validate(instance, { whitelist: true })
  return errors.map(e => e.property)
}

describe('fabric-governance DTOs (PROP-399 task 4.3/4.4)', () => {
  describe('GovernanceSnapshotListQueryDto', () => {
    it('defaults to page 1, limit 20', async () => {
      const dto = plainToInstance(GovernanceSnapshotListQueryDto, {})
      expect(dto.page).toBe(1)
      expect(dto.limit).toBe(20)
      expect(await validate(dto)).toHaveLength(0)
    })

    it('coerces numeric strings and accepts the boundaries 1 and 100', async () => {
      const dto = plainToInstance(GovernanceSnapshotListQueryDto, {
        page: '1',
        limit: '100',
      })
      expect(dto.page).toBe(1)
      expect(dto.limit).toBe(100)
      expect(await validate(dto)).toHaveLength(0)
    })

    it.each([
      [{ page: '0' }, 'page'],
      [{ page: '-1' }, 'page'],
      [{ page: '1.5' }, 'page'],
      [{ page: 'abc' }, 'page'],
      [{ limit: '0' }, 'limit'],
      [{ limit: '101' }, 'limit'],
      [{ limit: 'x' }, 'limit'],
    ])('rejects %j', async (plain, property) => {
      expect(await errorsOf(GovernanceSnapshotListQueryDto, plain)).toContain(
        property
      )
    })
  })

  describe('GovernanceSnapshotIdParamDto', () => {
    it('accepts a Mongo ObjectId and rejects anything else', async () => {
      expect(
        await errorsOf(GovernanceSnapshotIdParamDto, {
          id: new ObjectId().toHexString(),
        })
      ).toEqual([])
      expect(
        await errorsOf(GovernanceSnapshotIdParamDto, { id: 'not-an-id' })
      ).toEqual(['id'])
      expect(await errorsOf(GovernanceSnapshotIdParamDto, {})).toEqual(['id'])
    })
  })

  describe('GovernanceSnapshotResponseDto.fromEntity (redaction)', () => {
    const entity = Object.assign(new FabricGovernanceSnapshot(), {
      _id: new ObjectId(),
      snapshotCode: 'GOV-000003',
      version: 3,
      manifestSchemaVersion: 1,
      status: 'published',
      components: {
        legalTerms: [{ id: 'terms', version: 1, hash: 'a'.repeat(64) }],
        policySet: [{ key: 'K', value: '5', unit: '%', hash: 'b'.repeat(64) }],
        contractTemplate: [{ id: 't', version: 2, hash: 'c'.repeat(64) }],
        contractLayout: null,
        rentalExecutionPolicy: [
          { policyId: 'SIGN_FIRST', version: 1, hash: 'd'.repeat(64) },
        ],
        feeSchedule: null,
      },
      manifestHash: 'e'.repeat(64),
      ledgerStatus: 'pending',
      txHash: null,
      blockNumber: null,
      publishedBy: 'admin-1',
      publishedAt: new Date('2026-10-02T00:00:00.000Z'),
      createdAt: new Date('2026-10-02T00:00:00.000Z'),
      updatedAt: new Date('2026-10-02T00:00:01.000Z'),
    })

    it('exposes the id as a hex string and the sanitized manifest fields only', () => {
      const dto = GovernanceSnapshotResponseDto.fromEntity(entity)

      expect(dto).toEqual({
        id: entity._id.toHexString(),
        snapshotCode: 'GOV-000003',
        version: 3,
        manifestSchemaVersion: 1,
        status: 'published',
        components: entity.components,
        manifestHash: 'e'.repeat(64),
        ledgerStatus: 'pending',
        txHash: null,
        blockNumber: null,
        publishedBy: 'admin-1',
        publishedAt: '2026-10-02T00:00:00.000Z',
      })
      expect(Object.keys(dto)).not.toContain('_id')
      expect(Object.keys(dto)).not.toContain('createdAt')
    })
  })

  describe('GovernanceVerificationResponseDto', () => {
    it('is a plain pass-through of the verification result', () => {
      const result = {
        snapshotId: 'abc',
        version: 1,
        status: 'verified' as const,
        localManifestHash: 'a'.repeat(64),
        ledgerManifestHash: 'a'.repeat(64),
        mismatchFields: [],
        txHash: 'tx',
        blockNumber: null,
        networkMode: 'fabric' as const,
        reason: null,
        checkedAt: '2026-10-02T00:00:00.000Z',
      }
      expect(GovernanceVerificationResponseDto.fromResult(result)).toEqual(
        result
      )
    })
  })
})
