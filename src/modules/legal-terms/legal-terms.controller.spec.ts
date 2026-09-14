import { LegalTermsController } from './legal-terms.controller'
import type { LegalTermsService } from './legal-terms.service'
import type { UserPayload } from '../auth/interfaces/auth.interface'

describe('LegalTermsController', () => {
  let controller: LegalTermsController
  let service: {
    getCurrentPublishedTerms: jest.Mock
    getPublishedVersion: jest.Mock
    getAdminState: jest.Mock
    saveDraft: jest.Mock
    publishDraft: jest.Mock
  }

  beforeEach(() => {
    service = {
      getCurrentPublishedTerms: jest.fn(),
      getPublishedVersion: jest.fn(),
      getAdminState: jest.fn(),
      saveDraft: jest.fn(),
      publishDraft: jest.fn(),
    }

    controller = new LegalTermsController(
      service as unknown as LegalTermsService
    )
  })

  it('delegates getCurrentRentalTerms to service', async () => {
    service.getCurrentPublishedTerms.mockResolvedValue({
      key: 'rental-service-terms',
      version: 1,
      title: 'T1',
      summary: 'S1',
      sections: [],
      contentHash: 'hash1',
      publishedAt: new Date(),
    })

    const res = await controller.getCurrentRentalTerms()
    expect(res.version).toBe(1)
    expect(service.getCurrentPublishedTerms).toHaveBeenCalled()
  })

  it('delegates getRentalTermsVersion to service', async () => {
    service.getPublishedVersion.mockResolvedValue({
      key: 'rental-service-terms',
      version: 2,
      title: 'T2',
      summary: 'S2',
      sections: [],
      contentHash: 'hash2',
      publishedAt: new Date(),
    })

    const res = await controller.getRentalTermsVersion(2)
    expect(res.version).toBe(2)
    expect(service.getPublishedVersion).toHaveBeenCalledWith(2)
  })

  it('delegates saveDraft passing user id as actor', async () => {
    service.saveDraft.mockResolvedValue({
      draftRevision: 2,
    })

    const user: UserPayload = {
      _id: 'user-123',
      email: 'admin@test.com',
      roles: ['admin'],
    }
    const res = await controller.saveDraft(
      {
        title: 'Draft',
        summary: 'Summary',
        sections: [],
        expectedRevision: 1,
      },
      user
    )

    expect(res.draftRevision).toBe(2)
    expect(service.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Draft' }),
      'user-123'
    )
  })

  it('delegates publishDraft passing user id as actor', async () => {
    service.publishDraft.mockResolvedValue({
      key: 'rental-service-terms',
      version: 3,
      title: 'Published',
      summary: 'Summary',
      sections: [],
      contentHash: 'hash3',
      publishedAt: new Date(),
    })

    const user: UserPayload = {
      _id: 'user-123',
      email: 'admin@test.com',
      roles: ['admin'],
    }
    const res = await controller.publishDraft({ expectedRevision: 2 }, user)

    expect(res.version).toBe(3)
    expect(service.publishDraft).toHaveBeenCalledWith(
      { expectedRevision: 2 },
      'user-123'
    )
  })
})
