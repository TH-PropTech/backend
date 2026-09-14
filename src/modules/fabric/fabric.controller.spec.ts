import { BadRequestException } from '@nestjs/common'
import { FabricController } from './fabric.controller'
import { FabricService } from './fabric.service'
import { LedgerOutboxService } from './ledger-outbox.service'

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
    controller = new FabricController(
      fabricService as unknown as FabricService,
      ledgerOutboxService as unknown as LedgerOutboxService,
      logRepository as never
    )
  })

  it('returns truthful fabric status', () => {
    const status = controller.getStatus()
    expect(status.mode).toBe('fabric')
    expect(status.connectionState).toBe('connected')
    expect(status.ready).toBe(true)
    expect(status.errorCode).toBeNull()
    expect(fabricService.getStatus).toHaveBeenCalled()
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
})
