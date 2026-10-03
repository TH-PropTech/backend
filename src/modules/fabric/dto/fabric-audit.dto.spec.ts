import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ObjectId } from 'mongodb'
import {
  AuditEventIdParamDto,
  AuditEventsQueryDto,
  AuditOverviewResponseDto,
  AuditEventDetailResponseDto,
  AuditEventsPageResponseDto,
} from './fabric-audit.dto'

async function invalidFields(
  plain: Record<string, unknown>
): Promise<string[]> {
  const dto = plainToInstance(AuditEventsQueryDto, plain)
  return (await validate(dto)).map(error => error.property)
}

describe('fabric-audit DTOs (PROP-399 task 7.3/7.4)', () => {
  describe('AuditEventsQueryDto', () => {
    it('defaults to page 1, limit 20 and accepts an empty filter set', async () => {
      const dto = plainToInstance(AuditEventsQueryDto, {})
      expect(dto).toMatchObject({ page: 1, limit: 20 })
      expect(await validate(dto)).toHaveLength(0)
    })

    it('accepts every supported filter together', async () => {
      expect(
        await invalidFields({
          page: '2',
          limit: '100',
          contractId: new ObjectId().toHexString(),
          eventType: 'handover.completed',
          state: 'retryable',
          verificationState: 'not-recorded',
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-02T00:00:00.000Z',
          txId: 'a1b2c3-TX_9.x:y',
        })
      ).toEqual([])
    })

    it.each([
      [{ page: '0' }, 'page'],
      [{ limit: '101' }, 'limit'],
      [{ limit: '0' }, 'limit'],
      [{ eventType: 'drop.table' }, 'eventType'],
      [{ state: 'done' }, 'state'],
      [{ verificationState: 'ok' }, 'verificationState'],
      [{ from: 'yesterday' }, 'from'],
      [{ to: '2026-13-45' }, 'to'],
      [{ contractId: 'bad id!' }, 'contractId'],
      [{ contractId: 'a'.repeat(65) }, 'contractId'],
      [{ txId: 'x'.repeat(129) }, 'txId'],
      [{ txId: 'has space' }, 'txId'],
    ])('rejects %j', async (plain, property) => {
      expect(await invalidFields(plain)).toContain(property)
    })
  })

  describe('AuditEventIdParamDto', () => {
    it('accepts an ObjectId and rejects anything else', async () => {
      const ok = plainToInstance(AuditEventIdParamDto, {
        id: new ObjectId().toHexString(),
      })
      expect(await validate(ok)).toHaveLength(0)
      const bad = plainToInstance(AuditEventIdParamDto, { id: 'nope' })
      expect((await validate(bad)).map(e => e.property)).toEqual(['id'])
    })
  })

  describe('response models', () => {
    it('document the sanitized fields and nothing that could carry secrets', () => {
      const props = (target: object): string[] =>
        (
          Reflect.getMetadata('swagger/apiModelPropertiesArray', target) as
            | string[]
            | undefined
        )?.map(name => name.replace(/^:/, '')) ?? []

      expect(props(AuditOverviewResponseDto.prototype)).toEqual(
        expect.arrayContaining([
          'generatedAt',
          'runtime',
          'outbox',
          'worker',
          'ledger',
          'identityWarnings',
          'explorer',
          'coverage',
          'reconciliation',
        ])
      )
      expect(props(AuditEventDetailResponseDto.prototype)).toEqual(
        expect.arrayContaining([
          'id',
          'eventType',
          'status',
          'verificationState',
          'txId',
          'blockNumber',
          'explorerUrl',
          'dependencies',
          'explorer',
          'verification',
        ])
      )
      expect(props(AuditEventsPageResponseDto.prototype)).toEqual(
        expect.arrayContaining([
          'items',
          'total',
          'page',
          'limit',
          'totalPages',
        ])
      )
      const forbidden = [
        'args',
        'payload',
        'lastError',
        'certificate',
        'privateKey',
        'secret',
      ]
      for (const model of [
        AuditOverviewResponseDto,
        AuditEventDetailResponseDto,
        AuditEventsPageResponseDto,
      ]) {
        for (const name of props(model.prototype)) {
          expect(forbidden).not.toContain(name)
        }
      }
    })
  })
})
