import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ObjectId } from 'mongodb'
import { FabricController } from './fabric.controller'
import { RolesGuard } from '../../common/guards/roles.guard'

describe('FabricController audit routes (PROP-399 tasks 7.3/7.4)', () => {
  let audit: {
    getOverview: jest.Mock
    listEvents: jest.Mock
    getEvent: jest.Mock
    getWorkerHealth: jest.Mock
  }
  let controller: FabricController

  beforeEach(() => {
    audit = {
      getOverview: jest.fn(),
      listEvents: jest.fn(),
      getEvent: jest.fn(),
      getWorkerHealth: jest.fn(),
    }
    controller = new FabricController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
      {} as never
    )
  })

  it('overview: returns the service read model untouched', async () => {
    const overview = {
      generatedAt: '2026-10-02T00:00:00.000Z',
      runtime: { mode: 'simulation', state: 'simulation' },
    }
    audit.getOverview.mockResolvedValue(overview)
    await expect(controller.getAuditOverview()).resolves.toBe(overview)
  })

  it('events: forwards every filter and the pagination boundaries', async () => {
    const page = { items: [], total: 0, page: 1, limit: 100, totalPages: 0 }
    audit.listEvents.mockResolvedValue(page)

    const result = await controller.listAuditEvents({
      page: 1,
      limit: 100,
      contractId: 'c-1',
      eventType: 'handover.completed',
      state: 'confirmed',
      verificationState: 'verified',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-02T00:00:00.000Z',
      txId: 'tx-1',
    })

    expect(result).toBe(page)
    expect(audit.listEvents).toHaveBeenCalledWith({
      page: 1,
      limit: 100,
      contractId: 'c-1',
      eventType: 'handover.completed',
      state: 'confirmed',
      verificationState: 'verified',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-02T00:00:00.000Z',
      txId: 'tx-1',
    })
  })

  it('events: surfaces the stable AUDIT_FILTER_INVALID error', async () => {
    audit.listEvents.mockRejectedValue(
      new BadRequestException({ code: 'AUDIT_FILTER_INVALID' })
    )
    await expect(
      controller.listAuditEvents({ page: 1, limit: 20 })
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it.each([
    [
      'ready',
      {
        available: true,
        url: 'https://explorer.example.com/tx/t',
        reason: null,
      },
    ],
    ['degraded', { available: false, url: null, reason: 'EXPLORER_DEGRADED' }],
  ])(
    'detail: passes an Explorer %s action through',
    async (_label, explorer) => {
      audit.getEvent.mockResolvedValue({ id: 'e-1', explorer })
      const id = new ObjectId().toHexString()
      await expect(controller.getAuditEvent({ id })).resolves.toMatchObject({
        explorer,
      })
      expect(audit.getEvent).toHaveBeenCalledWith(id)
    }
  )

  it('detail: surfaces AUDIT_EVENT_NOT_FOUND', async () => {
    audit.getEvent.mockRejectedValue(
      new NotFoundException({ code: 'AUDIT_EVENT_NOT_FOUND' })
    )
    await expect(
      controller.getAuditEvent({ id: new ObjectId().toHexString() })
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('status: leaves /fabric/status healthy when the worker query fails', async () => {
    const fabric = {
      getStatus: jest.fn().mockReturnValue({ mode: 'fabric', ready: true }),
    }
    audit.getWorkerHealth.mockRejectedValue(new Error('mongo down'))
    const statusController = new FabricController(
      fabric as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
      {} as never
    )
    await expect(statusController.getStatus()).resolves.toEqual({
      mode: 'fabric',
      ready: true,
    })
  })

  describe('role matrix over the real @Roles metadata', () => {
    const guard = new RolesGuard(new Reflector())
    const proto = FabricController.prototype as unknown as Record<
      string,
      () => unknown
    >
    const allows = (handler: string, roles: string[]): boolean => {
      try {
        return guard.canActivate({
          getHandler: (): (() => unknown) | undefined => proto[handler],
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

    it.each(['getAuditOverview', 'listAuditEvents', 'getAuditEvent'])(
      '%s is readable by admin and staff only',
      handler => {
        expect(allows(handler, ['admin'])).toBe(true)
        expect(allows(handler, ['staff'])).toBe(true)
        expect(allows(handler, ['tenant'])).toBe(false)
        expect(allows(handler, ['landlord'])).toBe(false)
        expect(allows(handler, [])).toBe(false)
      }
    )
  })
})
