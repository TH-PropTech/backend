import type { UserPayload } from '../auth/interfaces/auth.interface'
import type {
  OwnershipTransferPreviewResponse,
  OwnershipTransferService,
} from './ownership-transfer.service'
import { OwnershipTransferController } from './ownership-transfer.controller'

describe('OwnershipTransferController', () => {
  it('passes the authenticated admin and idempotency header to the service', async () => {
    const preview = {
      transferId: 'transfer-id',
    } as unknown as OwnershipTransferPreviewResponse
    const previewMock = jest.fn().mockResolvedValue(preview)
    const applyMock = jest.fn().mockResolvedValue(preview)
    const getSummaryMock = jest.fn().mockResolvedValue(preview)
    const service = {
      preview: previewMock,
      apply: applyMock,
      getSummary: getSummaryMock,
    } as unknown as jest.Mocked<OwnershipTransferService>
    const controller = new OwnershipTransferController(service)
    const user: UserPayload = { _id: 'admin-id', roles: ['admin'] }
    const dto = { targetEmail: 'owner@example.com' }
    const previewHash = 'sha256:' + 'a'.repeat(64)

    await expect(controller.preview(dto, { user })).resolves.toBe(preview)
    await expect(
      controller.apply('transfer-id', { previewHash }, 'idem-1')
    ).resolves.toBe(preview)
    await expect(controller.getSummary('transfer-id')).resolves.toBe(preview)

    expect(previewMock).toHaveBeenCalledWith('owner@example.com', 'admin-id')
    expect(applyMock).toHaveBeenCalledWith(
      'transfer-id',
      { previewHash },
      'idem-1'
    )
    expect(getSummaryMock).toHaveBeenCalledWith('transfer-id')
  })
})
