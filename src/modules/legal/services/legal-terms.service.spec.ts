import { NotFoundException, ConflictException } from '@nestjs/common'
import type { Repository } from 'typeorm'
import { LegalTermsService, RENTAL_TERMS_KEY } from './legal-terms.service'
import {
  LegalDocument,
  type TermsLegalDocument,
} from '../schemas/legal-document.schema'

describe('LegalTermsService', () => {
  let service: LegalTermsService
  let repository: {
    findOne: jest.Mock
    save: jest.Mock
    remove: jest.Mock
    create: jest.Mock
  }

  beforeEach(() => {
    repository = {
      findOne: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      create: jest.fn((data?: Record<string, unknown>) => ({ ...data })),
    }

    service = new LegalTermsService(
      repository as unknown as Repository<LegalDocument>
    )
  })

  describe('getCurrentPublishedTerms', () => {
    it('returns the published terms document with the highest version', async () => {
      const mockDoc = {
        key: RENTAL_TERMS_KEY,
        version: 2,
        title: 'Điều khoản v2',
        summary: 'Tóm tắt v2',
        sections: [{ id: 's1', heading: 'H1', body: 'B1', order: 1 }],
        contentHash: 'hash-v2',
        publishedAt: new Date(),
      } as unknown as TermsLegalDocument

      repository.findOne.mockResolvedValue(mockDoc)

      const result = await service.getCurrentPublishedTerms()
      expect(result.version).toBe(2)
      expect(result.contentHash).toBe('hash-v2')
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { key: RENTAL_TERMS_KEY, status: 'published', kind: 'terms' },
        order: { version: 'DESC' },
      })
    })

    it('throws NotFoundException when no published terms exist', async () => {
      repository.findOne.mockResolvedValue(null)
      await expect(service.getCurrentPublishedTerms()).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('getPublishedVersion', () => {
    it('returns specific published version', async () => {
      const mockDoc = {
        key: RENTAL_TERMS_KEY,
        version: 1,
        title: 'Điều khoản v1',
        summary: 'Tóm tắt v1',
        sections: [],
        contentHash: 'hash-v1',
      } as unknown as TermsLegalDocument

      repository.findOne.mockResolvedValue(mockDoc)

      const result = await service.getPublishedVersion(1)
      expect(result.version).toBe(1)
      expect(repository.findOne).toHaveBeenCalledWith({
        where: {
          key: RENTAL_TERMS_KEY,
          version: 1,
          status: 'published',
          kind: 'terms',
        },
      })
    })

    it('throws NotFoundException when specific version not found', async () => {
      repository.findOne.mockResolvedValue(null)
      await expect(service.getPublishedVersion(99)).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('saveDraft', () => {
    it('creates a new draft when no draft exists', async () => {
      repository.findOne.mockResolvedValue(null)
      repository.save.mockImplementation((doc: unknown) =>
        Promise.resolve(doc as TermsLegalDocument)
      )

      const result = await service.saveDraft(
        {
          title: 'Draft Title',
          summary: 'Draft Summary',
          sections: [{ id: 's1', heading: 'H1', body: 'B1', order: 1 }],
          expectedRevision: 1,
        },
        'admin-user'
      )

      expect(result.status).toBe('draft')
      expect(result.draftRevision).toBe(1)
      expect(result.createdBy).toBe('admin-user')
      // bản nháp mới được gắn kind 'terms' (không rò sang loại khác)
      expect(result.kind).toBe('terms')
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { key: RENTAL_TERMS_KEY, status: 'draft', kind: 'terms' },
      })
    })

    it('updates existing draft and increments revision if expectedRevision matches', async () => {
      const existingDraft = {
        key: RENTAL_TERMS_KEY,
        status: 'draft',
        draftRevision: 2,
      } as unknown as TermsLegalDocument

      repository.findOne.mockResolvedValue(existingDraft)
      repository.save.mockImplementation((doc: unknown) =>
        Promise.resolve(doc as TermsLegalDocument)
      )

      const result = await service.saveDraft(
        {
          title: 'Updated Title',
          summary: 'Updated Summary',
          sections: [],
          expectedRevision: 2,
        },
        'admin-user'
      )

      expect(result.draftRevision).toBe(3)
      expect(result.updatedBy).toBe('admin-user')
    })

    it('throws ConflictException when draft revision does not match expectedRevision', async () => {
      const existingDraft = {
        key: RENTAL_TERMS_KEY,
        status: 'draft',
        draftRevision: 3,
      } as unknown as TermsLegalDocument

      repository.findOne.mockResolvedValue(existingDraft)

      await expect(
        service.saveDraft(
          {
            title: 'Title',
            summary: 'Summary',
            sections: [],
            expectedRevision: 2,
          },
          'admin-user'
        )
      ).rejects.toThrow(ConflictException)
    })
  })

  describe('publishDraft', () => {
    it('publishes draft and increments version', async () => {
      const existingDraft = {
        key: RENTAL_TERMS_KEY,
        status: 'draft',
        draftRevision: 2,
        title: 'Terms Title',
        summary: 'Terms Summary',
        sections: [{ id: 's1', heading: 'Heading', body: 'Body', order: 1 }],
      } as unknown as TermsLegalDocument

      const latestPublished = {
        version: 1,
      } as unknown as TermsLegalDocument

      repository.findOne
        .mockResolvedValueOnce(existingDraft) // find draft
        .mockResolvedValueOnce(latestPublished) // find latest published

      repository.save.mockImplementation((doc: unknown) =>
        Promise.resolve(doc as TermsLegalDocument)
      )
      repository.remove.mockResolvedValue(existingDraft)

      const result = await service.publishDraft(
        { expectedRevision: 2 },
        'admin-user'
      )

      expect(result.version).toBe(2)
      expect(result.contentHash).toHaveLength(64)
      expect(repository.remove).toHaveBeenCalledWith(existingDraft)
      expect(repository.findOne).toHaveBeenNthCalledWith(2, {
        where: { key: RENTAL_TERMS_KEY, status: 'published', kind: 'terms' },
        order: { version: 'DESC' },
      })
    })

    it('throws NotFoundException when draft does not exist', async () => {
      repository.findOne.mockResolvedValue(null)

      await expect(
        service.publishDraft({ expectedRevision: 1 }, 'admin-user')
      ).rejects.toThrow(NotFoundException)
    })

    it('throws ConflictException when draft revision does not match expected', async () => {
      const existingDraft = {
        draftRevision: 5,
      } as unknown as TermsLegalDocument

      repository.findOne.mockResolvedValue(existingDraft)

      await expect(
        service.publishDraft({ expectedRevision: 4 }, 'admin-user')
      ).rejects.toThrow(ConflictException)
    })
  })
})
