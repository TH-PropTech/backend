import 'reflect-metadata'
import { LegalTermsController } from './legal-terms.controller'
import type { LegalTermsService } from '../services/legal-terms.service'
import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator'
import type { UserPayload } from '../../auth/interfaces/auth.interface'

describe('LegalTermsController', () => {
  let controller: LegalTermsController
  let service: {
    getCurrentPublishedTerms: jest.Mock
    getPublishedVersion: jest.Mock
    getAdminState: jest.Mock
    saveDraft: jest.Mock
    publishDraft: jest.Mock
    submitForReview: jest.Mock
    approveDraft: jest.Mock
    requestChanges: jest.Mock
  }

  beforeEach(() => {
    service = {
      getCurrentPublishedTerms: jest.fn(),
      getPublishedVersion: jest.fn(),
      getAdminState: jest.fn(),
      saveDraft: jest.fn(),
      publishDraft: jest.fn(),
      submitForReview: jest.fn(),
      approveDraft: jest.fn(),
      requestChanges: jest.fn(),
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
    expect(res.reviewStatus).toBe('editing')
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

  describe('review workflow delegation', () => {
    const user: UserPayload = {
      _id: 'user-123',
      email: 'admin@test.com',
      roles: ['admin'],
    }

    it('delegates submit-review, approve and request-changes with the actor id', async () => {
      const result = {
        success: true,
        draftRevision: 2,
        reviewStatus: 'in_review',
      }
      service.submitForReview.mockResolvedValue(result)
      service.approveDraft.mockResolvedValue({
        ...result,
        reviewStatus: 'approved',
      })
      service.requestChanges.mockResolvedValue({
        ...result,
        reviewStatus: 'editing',
      })

      expect(await controller.submitReview({ expectedRevision: 2 }, user)).toBe(
        result
      )
      expect(service.submitForReview).toHaveBeenCalledWith(
        { expectedRevision: 2 },
        'user-123'
      )

      const approved = await controller.approveDraft(
        { expectedRevision: 2 },
        user
      )
      expect(approved.reviewStatus).toBe('approved')
      expect(service.approveDraft).toHaveBeenCalledWith(
        { expectedRevision: 2 },
        'user-123'
      )

      await controller.requestChanges(
        { expectedRevision: 2, note: 'fix' },
        user
      )
      expect(service.requestChanges).toHaveBeenCalledWith(
        { expectedRevision: 2, note: 'fix' },
        'user-123'
      )
    })

    it('passes effectiveFrom through publishDraft', async () => {
      service.publishDraft.mockResolvedValue({ version: 4 })
      const dto = {
        expectedRevision: 2,
        effectiveFrom: '2030-01-01T00:00:00.000Z',
      }
      await controller.publishDraft(dto, user)
      expect(service.publishDraft).toHaveBeenCalledWith(dto, 'user-123')
    })
  })

  describe('route metadata', () => {
    const proto = LegalTermsController.prototype as unknown as Record<
      string,
      object
    >
    const roles = (name: string): unknown =>
      Reflect.getMetadata(ROLES_KEY, proto[name]!)
    const isPublic = (name: string): unknown =>
      Reflect.getMetadata(IS_PUBLIC_KEY, proto[name]!)

    it.each([
      'getAdminState',
      'saveDraft',
      'submitReview',
      'approveDraft',
      'requestChanges',
      'publishDraft',
    ])('%s is admin only', name => {
      expect(roles(name)).toEqual(['admin'])
      expect(isPublic(name)).toBeUndefined()
    })

    it.each(['getCurrentRentalTerms', 'getRentalTermsVersion'])(
      '%s stays public without roles',
      name => {
        expect(isPublic(name)).toBe(true)
        expect(roles(name)).toBeUndefined()
      }
    )
  })
})
