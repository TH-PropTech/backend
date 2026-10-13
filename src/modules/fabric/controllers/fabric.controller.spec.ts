import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ObjectId } from 'mongodb'
import { FabricController } from './fabric.controller'
import { FabricService } from '../services/fabric.service'
import { LedgerOutboxService } from '../services/ledger-outbox.service'
import { FabricGovernanceService } from '../services/fabric-governance.service'
import { FabricGovernanceSnapshot } from '../schemas/fabric-governance-snapshot.schema'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { FabricStatusResponseDto } from './fabric.controller'
import { LedgerAuditQueryService } from '../services/ledger-audit-query.service'

describe('FabricController', () => {
  let controller: FabricController
  let fabricService: {
    getStatus: jest.Mock
    submitTransaction: jest.Mock
    evaluateTransaction: jest.Mock
  }
  let ledgerOutboxService: {
    retryTerminal: jest.Mock
  }
  let logRepository: {
    find: jest.Mock
  }
  let auditQueryService: {
    getWorkerHealth: jest.Mock
    getOverview: jest.Mock
    listEvents: jest.Mock
    getEvent: jest.Mock
  }
  let governanceService: {
    publish: jest.Mock
    list: jest.Mock
    getById: jest.Mock
    verify: jest.Mock
  }

  beforeEach(() => {
    fabricService = {
      getStatus: jest.fn().mockReturnValue({
        mode: 'fabric',
        connectionState: 'connected',
        ready: true,
        channel: 'proptech-channel',
        chaincode: 'proptech',
        lastCheckedAt: '2026-09-14T10:00:00.000Z',
        errorCode: null,
      }),
      submitTransaction: jest.fn().mockResolvedValue({
        txHash: 'tx-123',
        blockNumber: null,
        success: true,
        networkMode: 'fabric',
      }),
      evaluateTransaction: jest.fn().mockResolvedValue([{ id: 'c-1' }]),
    }
    ledgerOutboxService = {
      retryTerminal: jest.fn().mockResolvedValue({
        _id: 'outbox-1',
        status: 'pending',
      }),
    }
    logRepository = {
      find: jest.fn().mockResolvedValue([]),
    }
    auditQueryService = {
      getWorkerHealth: jest
        .fn()
        .mockResolvedValue({ state: 'ready', oldestPendingAt: null }),
      getOverview: jest.fn(),
      listEvents: jest.fn(),
      getEvent: jest.fn(),
    }
    governanceService = {
      publish: jest.fn(),
      list: jest.fn(),
      getById: jest.fn(),
      verify: jest.fn(),
    }
    controller = new FabricController(
      fabricService as unknown as FabricService,
      ledgerOutboxService as unknown as LedgerOutboxService,
      logRepository as never,
      governanceService as unknown as FabricGovernanceService,
      auditQueryService as unknown as LedgerAuditQueryService,
      {} as never
    )
  })

  it('returns truthful fabric status', async () => {
    const status = await controller.getStatus()
    expect(status.mode).toBe('fabric')
    expect(status.connectionState).toBe('connected')
    expect(status.ready).toBe(true)
    expect(status.errorCode).toBeNull()
    expect(fabricService.getStatus).toHaveBeenCalled()
  })

  describe('composite readiness on /fabric/status (PROP-399 task 6.4)', () => {
    const composite = {
      mode: 'fabric',
      connectionState: 'connected',
      ready: true,
      channel: 'proptech-channel',
      chaincode: 'proptech',
      chaincodeAbiVersion: 2,
      lastCheckedAt: '2026-10-02T10:00:00.000Z',
      errorCode: null,
      evidenceSchemaVersions: [2, 3],
      gateway: { state: 'connected', abiVersion: 2 },
      identities: {
        writer: {
          state: 'expiring',
          expiresAt: '2026-10-20T00:00:00.000Z',
          expiringSoon: true,
          errorCode: 'FABRIC_IDENTITY_EXPIRING',
        },
        reader: {
          state: 'ok',
          expiresAt: '2027-10-20T00:00:00.000Z',
          expiringSoon: false,
          errorCode: null,
        },
        operator: {
          state: 'ok',
          expiresAt: '2027-10-20T00:00:00.000Z',
          expiringSoon: false,
          errorCode: null,
        },
      },
      ledger: {
        height: 42,
        currentBlockHash: 'dead',
        observedAt: '2026-10-02T10:00:00.000Z',
      },
      explorer: { enabled: true, state: 'degraded', publicUrl: null },
      errorCodes: ['FABRIC_IDENTITY_EXPIRING', 'FABRIC_EXPLORER_DEGRADED'],
    }

    it('returns the composite readiness additively, keeping every legacy field intact and adding the worker block', async () => {
      fabricService.getStatus.mockReturnValue(composite)
      const status = await controller.getStatus()
      expect(status).toEqual({
        ...composite,
        worker: { state: 'ready', oldestPendingAt: null },
      })
      expect(status).toMatchObject({
        mode: 'fabric',
        connectionState: 'connected',
        ready: true,
        channel: 'proptech-channel',
        chaincode: 'proptech',
        lastCheckedAt: '2026-10-02T10:00:00.000Z',
        errorCode: null,
      })
    })

    it('carries no credential material, only stable codes, expiry and hashes', async () => {
      fabricService.getStatus.mockReturnValue(composite)
      const serialized = JSON.stringify(await controller.getStatus())
      expect(serialized).not.toMatch(/BEGIN|PRIVATE|cert\.pem|key\.pem|secret/i)
    })

    it('documents every additive field in the Swagger model without removing the legacy ones', () => {
      const documented = (
        Reflect.getMetadata(
          'swagger/apiModelPropertiesArray',
          FabricStatusResponseDto.prototype
        ) as string[]
      ).map(name => name.replace(/^:/, ''))
      expect(documented).toEqual(
        expect.arrayContaining([
          'mode',
          'connectionState',
          'ready',
          'channel',
          'chaincode',
          'lastCheckedAt',
          'errorCode',
          'chaincodeAbiVersion',
          'evidenceSchemaVersions',
          'gateway',
          'identities',
          'ledger',
          'explorer',
          'errorCodes',
        ])
      )
    })

    it('stays readable by admin and staff only', () => {
      const guard = new RolesGuard(new Reflector())
      const allows = (roles: string[]): boolean => {
        try {
          return guard.canActivate({
            getHandler: (): unknown =>
              (
                FabricController.prototype as unknown as Record<
                  string,
                  () => unknown
                >
              ).getStatus,
            getClass: (): unknown => FabricController,
            switchToHttp: (): unknown => ({
              getRequest: (): unknown => ({ user: { roles } }),
            }),
          } as unknown as ExecutionContext)
        } catch (error) {
          if (error instanceof ForbiddenException) return false
          throw error
        }
      }
      expect(allows(['admin'])).toBe(true)
      expect(allows(['staff'])).toBe(true)
      expect(allows(['tenant'])).toBe(false)
      expect(allows(['landlord'])).toBe(false)
    })
  })

  it('delegates submitTx to FabricService with metadata', async () => {
    const result = await controller.submitTx({
      action: 'createContract',
      args: ['c-1'],
      contractId: 'c-1',
    })
    expect(result.txHash).toBe('tx-123')
    expect(result.networkMode).toBe('fabric')
    expect(fabricService.submitTransaction).toHaveBeenCalledWith(
      'createContract',
      ['c-1'],
      { contractId: 'c-1', paymentId: undefined }
    )
  })

  it('translates submission failure into BadRequestException', async () => {
    fabricService.submitTransaction.mockRejectedValue(
      new Error('connection drop')
    )
    await expect(
      controller.submitTx({ action: 'createContract', args: ['c-1'] })
    ).rejects.toThrow(BadRequestException)
  })

  it('delegates queryTx to FabricService evaluateTransaction', async () => {
    const result = await controller.queryTx({
      action: 'readContract',
      args: ['c-1'],
    })
    expect(result).toEqual([{ id: 'c-1' }])
    expect(fabricService.evaluateTransaction).toHaveBeenCalledWith(
      'readContract',
      ['c-1']
    )
  })

  it('delegates retryOutboxEvent to LedgerOutboxService with determined role', async () => {
    const result = await controller.retryOutboxEvent(
      '507f1f77bcf86cd799439011',
      {
        roles: ['staff'],
      }
    )
    expect(result).toEqual({ _id: 'outbox-1', status: 'pending' })
    expect(ledgerOutboxService.retryTerminal).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      'staff'
    )
  })

  it('passes admin role when user has admin role', async () => {
    await controller.retryOutboxEvent('507f1f77bcf86cd799439011', {
      roles: ['admin', 'landlord'],
    })
    expect(ledgerOutboxService.retryTerminal).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      'admin'
    )
  })

  describe('governance snapshots (PROP-399 tasks 4.3/4.4)', () => {
    const snapshot = Object.assign(new FabricGovernanceSnapshot(), {
      _id: new ObjectId(),
      snapshotCode: 'GOV-000001',
      version: 1,
      manifestSchemaVersion: 1,
      status: 'published',
      components: {
        legalTerms: [],
        policySet: [],
        contractTemplate: [],
        contractLayout: null,
        rentalExecutionPolicy: [],
        feeSchedule: null,
      },
      manifestHash: 'a'.repeat(64),
      ledgerStatus: 'pending',
      txHash: null,
      blockNumber: null,
      publishedBy: 'admin-1',
      publishedAt: new Date('2026-10-02T00:00:00.000Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const response = (): { status: jest.Mock } => ({ status: jest.fn() })

    it('publish: delegates as the admin actor and returns a redacted snapshot (201 left to Nest) when created', async () => {
      governanceService.publish.mockResolvedValue({ snapshot, created: true })
      const res = response()

      const result = await controller.publishGovernanceSnapshot(
        'admin-1',
        res as never
      )

      expect(governanceService.publish).toHaveBeenCalledWith({
        id: 'admin-1',
        role: 'admin',
      })
      expect(result.created).toBe(true)
      expect(result.snapshot.id).toBe(snapshot._id.toHexString())
      expect(Object.keys(result.snapshot)).not.toContain('_id')
      expect(res.status).not.toHaveBeenCalled()
    })

    it('publish: reports an idempotent duplicate as 200 with created=false', async () => {
      governanceService.publish.mockResolvedValue({ snapshot, created: false })
      const res = response()

      const result = await controller.publishGovernanceSnapshot(
        'admin-1',
        res as never
      )

      expect(result.created).toBe(false)
      expect(res.status).toHaveBeenCalledWith(200)
    })

    it('publish: propagates stable domain errors from the service untouched', async () => {
      governanceService.publish.mockRejectedValue(
        new UnprocessableEntityException({
          code: 'GOVERNANCE_SNAPSHOT_INCOMPLETE',
          missing: ['legalTerms'],
        })
      )
      await expect(
        controller.publishGovernanceSnapshot('admin-1', response() as never)
      ).rejects.toBeInstanceOf(UnprocessableEntityException)
    })

    it('list: returns a paginated, redacted page honoring boundaries', async () => {
      governanceService.list.mockResolvedValue({
        items: [snapshot],
        total: 101,
        page: 2,
        limit: 100,
        totalPages: 2,
      })

      const page = await controller.listGovernanceSnapshots({
        page: 2,
        limit: 100,
      })

      expect(governanceService.list).toHaveBeenCalledWith({
        page: 2,
        limit: 100,
      })
      expect(page).toMatchObject({
        total: 101,
        page: 2,
        limit: 100,
        totalPages: 2,
      })
      expect(page.items[0]?.id).toBe(snapshot._id.toHexString())
    })

    it('list: returns an empty page when there are no snapshots', async () => {
      governanceService.list.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      })
      await expect(
        controller.listGovernanceSnapshots({ page: 1, limit: 20 })
      ).resolves.toMatchObject({ items: [], total: 0, totalPages: 0 })
    })

    it('detail: returns the redacted snapshot, and surfaces not-found', async () => {
      governanceService.getById.mockResolvedValue(snapshot)
      await expect(
        controller.getGovernanceSnapshot({ id: snapshot._id.toHexString() })
      ).resolves.toMatchObject({ snapshotCode: 'GOV-000001' })

      governanceService.getById.mockRejectedValue(
        new NotFoundException({ code: 'GOVERNANCE_SNAPSHOT_NOT_FOUND' })
      )
      await expect(
        controller.getGovernanceSnapshot({ id: new ObjectId().toHexString() })
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it.each([
      ['verified', 'a'.repeat(64)],
      ['mismatch', 'b'.repeat(64)],
      ['unavailable', null],
      ['not-recorded', null],
    ])(
      'verify: maps a %s result through unchanged',
      async (status, ledgerHash) => {
        governanceService.verify.mockResolvedValue({
          snapshotId: snapshot._id.toHexString(),
          version: 1,
          status,
          localManifestHash: 'a'.repeat(64),
          ledgerManifestHash: ledgerHash,
          mismatchFields: status === 'mismatch' ? ['manifestHash'] : [],
          txHash: null,
          blockNumber: null,
          networkMode: 'fabric',
          reason: status === 'unavailable' ? 'FABRIC_UNAVAILABLE' : null,
          checkedAt: '2026-10-02T00:00:00.000Z',
        })
        const result = await controller.verifyGovernanceSnapshot({
          id: snapshot._id.toHexString(),
        })
        expect(governanceService.verify).toHaveBeenCalledWith(
          snapshot._id.toHexString()
        )
        expect(result.status).toBe(status)
        expect(result.ledgerManifestHash).toBe(ledgerHash)
      }
    )

    describe('role matrix (RolesGuard over the real @Roles metadata)', () => {
      const guard = new RolesGuard(new Reflector())
      const proto = FabricController.prototype as unknown as Record<
        string,
        () => unknown
      >

      function allows(handler: string, roles: string[]): boolean {
        const context = {
          getHandler: (): (() => unknown) | undefined => proto[handler],
          getClass: (): unknown => FabricController,
          switchToHttp: (): unknown => ({
            getRequest: (): unknown => ({ user: { roles } }),
          }),
        } as unknown as ExecutionContext
        try {
          return guard.canActivate(context)
        } catch (error) {
          if (error instanceof ForbiddenException) return false
          throw error
        }
      }

      const adminOnly = {
        admin: true,
        staff: false,
        tenant: false,
        landlord: false,
      }
      const adminAndStaff = {
        admin: true,
        staff: true,
        tenant: false,
        landlord: false,
      }

      it.each([
        ['publishGovernanceSnapshot', adminOnly],
        ['listGovernanceSnapshots', adminAndStaff],
        ['getGovernanceSnapshot', adminAndStaff],
        ['verifyGovernanceSnapshot', adminAndStaff],
      ])('%s', (handler, matrix) => {
        for (const [role, expected] of Object.entries(matrix)) {
          expect({ role, allowed: allows(handler, [role]) }).toEqual({
            role,
            allowed: expected,
          })
        }
      })
    })
  })
})
