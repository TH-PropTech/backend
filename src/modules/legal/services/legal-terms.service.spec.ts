import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { Repository } from 'typeorm'
import {
  DEFAULT_RENTAL_TERMS_FIXTURE,
  LegalTermsService,
  RENTAL_TERMS_KEY,
} from './legal-terms.service'
import type { SaveDraftDto } from '../dto/save-draft.dto'
import type { LegalDocument } from '../schemas/legal-document.schema'
import { computeCanonicalTermsHash } from '../utils/legal-terms.canonical'
import {
  LegalDocumentMemoryRepository,
  type LegalDocumentRow,
} from '../utils/legal-document-memory-repository.fixtures'

const SECTIONS = [{ id: 's1', heading: 'H1', body: 'B1', order: 1 }]
const DAY = 24 * 60 * 60 * 1000

function publishedRow(
  version: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    kind: 'terms',
    key: RENTAL_TERMS_KEY,
    version,
    title: `Điều khoản v${version}`,
    summary: `Tóm tắt v${version}`,
    sections: SECTIONS,
    contentHash: `hash-v${version}`,
    status: 'published',
    draftRevision: 1,
    publishedBy: 'admin-1',
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function draftRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    kind: 'terms',
    key: RENTAL_TERMS_KEY,
    version: 0,
    title: 'Draft',
    summary: 'Draft summary',
    sections: SECTIONS,
    contentHash: '',
    status: 'draft',
    draftRevision: 3,
    createdBy: 'editor',
    updatedBy: 'editor',
    ...overrides,
  }
}

describe('LegalTermsService', () => {
  let repo: LegalDocumentMemoryRepository
  let legalSourcesService: { findExistingKeys: jest.Mock }

  function build(allowSelfApproval?: boolean): LegalTermsService {
    const config =
      allowSelfApproval === undefined
        ? undefined
        : ({
            get: (key: string) =>
              key === 'legalTerms.allowSelfApproval'
                ? allowSelfApproval
                : undefined,
          } as unknown as ConfigService)
    return new LegalTermsService(
      repo as unknown as Repository<LegalDocument>,
      legalSourcesService as never,
      config
    )
  }

  const draftIn = (): LegalDocumentRow | undefined =>
    repo.rows.find(r => r['status'] === 'draft')

  beforeEach(() => {
    repo = new LegalDocumentMemoryRepository()
    legalSourcesService = {
      findExistingKeys: jest.fn((keys: string[]) => Promise.resolve(keys)),
    }
  })

  describe('getCurrentPublishedTerms / getPublishedVersion', () => {
    it('returns the highest published version', async () => {
      repo.seed([publishedRow(1), publishedRow(2)])
      const result = await build().getCurrentPublishedTerms()
      expect(result.version).toBe(2)
      expect(result.contentHash).toBe('hash-v2')
      expect(result.effectiveFrom).toBeNull()
    })

    it('treats a legacy published doc without effectiveFrom as current', async () => {
      repo.seed([publishedRow(1)])
      const result = await build().getCurrentPublishedTerms()
      expect(result.version).toBe(1)
    })

    it('throws NotFoundException when no published terms exist', async () => {
      await expect(build().getCurrentPublishedTerms()).rejects.toThrow(
        NotFoundException
      )
    })

    it('does not return a scheduled version as current but returns it by version', async () => {
      const future = new Date(Date.now() + 5 * DAY)
      repo.seed([publishedRow(1), publishedRow(2, { effectiveFrom: future })])
      const service = build()

      expect((await service.getCurrentPublishedTerms()).version).toBe(1)
      const scheduled = await service.getPublishedVersion(2)
      expect(scheduled.version).toBe(2)
      expect(scheduled.effectiveFrom).toEqual(future)
    })

    it('switches to the version once its effectiveFrom has passed', async () => {
      repo.seed([
        publishedRow(1),
        publishedRow(2, { effectiveFrom: new Date(Date.now() - 1000) }),
      ])
      expect((await build().getCurrentPublishedTerms()).version).toBe(2)
    })

    it('throws NotFoundException for an unknown version', async () => {
      await expect(build().getPublishedVersion(99)).rejects.toThrow(
        NotFoundException
      )
    })
  })

  describe('getAdminState', () => {
    it('reports effective as published, the highest future version as scheduled', async () => {
      const future = new Date(Date.now() + 2 * DAY)
      repo.seed([
        publishedRow(1),
        publishedRow(2, { effectiveFrom: future }),
        publishedRow(3, { effectiveFrom: new Date(Date.now() + 9 * DAY) }),
      ])
      const state = await build().getAdminState()
      expect(state.published?.version).toBe(1)
      expect(state.scheduled?.version).toBe(3)
      expect(state.draft).toBeNull()
    })

    it('has scheduled null when nothing is scheduled', async () => {
      repo.seed([publishedRow(1)])
      expect((await build().getAdminState()).scheduled).toBeNull()
    })

    it('defaults reviewStatus to editing for a legacy draft and exposes review fields', async () => {
      repo.seed([publishedRow(1), draftRow()])
      const legacy = (await build().getAdminState()).draft
      expect(legacy?.reviewStatus).toBe('editing')
      expect(legacy?.updatedBy).toBe('editor')

      const at = new Date()
      draftIn()!['reviewStatus'] = 'in_review'
      draftIn()!['submittedBy'] = 'editor'
      draftIn()!['submittedAt'] = at
      draftIn()!['reviewNote'] = 'note'
      const reviewed = (await build().getAdminState()).draft
      expect(reviewed).toMatchObject({
        reviewStatus: 'in_review',
        submittedBy: 'editor',
        submittedAt: at,
        reviewNote: 'note',
      })
    })
  })

  describe('saveDraft', () => {
    const dto = (expectedRevision: number): SaveDraftDto => ({
      title: 'T',
      summary: 'S',
      sections: SECTIONS,
      expectedRevision,
    })

    it('creates a new editing draft when none exists', async () => {
      const result = await build().saveDraft(dto(1), 'admin-user')
      expect(result.status).toBe('draft')
      expect(result.draftRevision).toBe(1)
      expect(result.createdBy).toBe('admin-user')
      expect(result.kind).toBe('terms')
      expect(draftIn()?.['reviewStatus']).toBe('editing')
    })

    it('updates the draft and bumps the revision', async () => {
      repo.seed([draftRow({ draftRevision: 2 })])
      const result = await build().saveDraft(dto(2), 'admin-user')
      expect(result.draftRevision).toBe(3)
      expect(result.updatedBy).toBe('admin-user')
      expect(draftIn()?.['draftRevision']).toBe(3)
    })

    it('throws ConflictException on stale revision', async () => {
      repo.seed([draftRow({ draftRevision: 3 })])
      await expect(build().saveDraft(dto(2), 'a')).rejects.toThrow(
        'TERMS_DRAFT_STALE'
      )
    })

    it('resets an approved draft to editing and clears review fields', async () => {
      repo.seed([
        draftRow({
          draftRevision: 4,
          reviewStatus: 'approved',
          submittedBy: 'editor',
          submittedAt: new Date(),
          reviewedBy: 'reviewer',
          reviewedAt: new Date(),
          reviewNote: 'old',
        }),
      ])
      await build().saveDraft(dto(4), 'admin-user')
      const row = draftIn()!
      expect(row['reviewStatus']).toBe('editing')
      expect(row['draftRevision']).toBe(5)
      for (const field of [
        'submittedBy',
        'submittedAt',
        'reviewedBy',
        'reviewedAt',
        'reviewNote',
      ]) {
        expect(row[field]).toBeUndefined()
      }
    })

    it('rejects a draft citing a legal source key that does not exist', async () => {
      legalSourcesService.findExistingKeys.mockResolvedValue([])
      await expect(
        build().saveDraft(
          {
            ...dto(1),
            sections: [{ ...SECTIONS[0]!, sourceKeys: ['khong-ton-tai'] }],
          },
          'a'
        )
      ).rejects.toThrow(BadRequestException)
    })

    it('stores sourceKeys cited by sections', async () => {
      await build().saveDraft(
        {
          ...dto(1),
          sections: [{ ...SECTIONS[0]!, sourceKeys: ['dang-ky-tam-tru'] }],
        },
        'a'
      )
      expect(legalSourcesService.findExistingKeys).toHaveBeenCalledWith([
        'dang-ky-tam-tru',
      ])
    })
  })

  describe('review workflow', () => {
    beforeEach(() => {
      repo.seed([publishedRow(1)])
    })

    it('runs draft -> submit -> approve -> publish', async () => {
      const service = build()
      const saved = await service.saveDraft(
        { title: 'T', summary: 'S', sections: SECTIONS, expectedRevision: 1 },
        'editor'
      )
      const rev = saved.draftRevision

      const submitted = await service.submitForReview(
        { expectedRevision: rev },
        'editor'
      )
      expect(submitted).toMatchObject({
        success: true,
        reviewStatus: 'in_review',
      })
      expect(draftIn()).toMatchObject({
        reviewStatus: 'in_review',
        submittedBy: 'editor',
      })

      const approved = await service.approveDraft(
        { expectedRevision: rev },
        'reviewer'
      )
      expect(approved.reviewStatus).toBe('approved')
      expect(draftIn()).toMatchObject({
        reviewStatus: 'approved',
        reviewedBy: 'reviewer',
      })

      const published = await service.publishDraft(
        { expectedRevision: rev },
        'reviewer'
      )
      expect(published.version).toBe(2)
      expect(published.effectiveFrom).toBeNull()
      expect(published.contentHash).toHaveLength(64)
      expect(draftIn()).toBeUndefined()
    })

    it('submit: 404 without draft, 409 stale, 409 invalid state', async () => {
      const service = build()
      await expect(
        service.submitForReview({ expectedRevision: 1 }, 'a')
      ).rejects.toThrow(NotFoundException)

      repo.seed([draftRow({ draftRevision: 3 })])
      await expect(
        service.submitForReview({ expectedRevision: 2 }, 'a')
      ).rejects.toThrow('TERMS_DRAFT_STALE')

      draftIn()!['reviewStatus'] = 'approved'
      await expect(
        service.submitForReview({ expectedRevision: 3 }, 'a')
      ).rejects.toThrow('TERMS_INVALID_REVIEW_STATE')
    })

    it('submits a legacy draft that has no reviewStatus', async () => {
      repo.seed([draftRow()])
      const result = await build().submitForReview(
        { expectedRevision: 3 },
        'editor'
      )
      expect(result.reviewStatus).toBe('in_review')
    })

    it('approve requires in_review', async () => {
      repo.seed([draftRow()])
      await expect(
        build(true).approveDraft({ expectedRevision: 3 }, 'reviewer')
      ).rejects.toThrow('TERMS_INVALID_REVIEW_STATE')
    })

    it('forbids self-approval by the last editor', async () => {
      repo.seed([draftRow({ reviewStatus: 'in_review' })])
      const err = await build()
        .approveDraft({ expectedRevision: 3 }, 'editor')
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ForbiddenException)
      expect((err as Error).message).toBe('TERMS_SELF_APPROVAL_FORBIDDEN')
      expect(draftIn()?.['reviewStatus']).toBe('in_review')
    })

    it('forbids self-approval when the flag is explicitly false', async () => {
      repo.seed([draftRow({ reviewStatus: 'in_review' })])
      await expect(
        build(false).approveDraft({ expectedRevision: 3 }, 'editor')
      ).rejects.toThrow(ForbiddenException)
    })

    it('allows self-approval with LEGAL_TERMS_ALLOW_SELF_APPROVAL', async () => {
      repo.seed([draftRow({ reviewStatus: 'in_review' })])
      const result = await build(true).approveDraft(
        { expectedRevision: 3 },
        'editor'
      )
      expect(result.reviewStatus).toBe('approved')
    })

    it('lets a different admin approve', async () => {
      repo.seed([draftRow({ reviewStatus: 'in_review' })])
      const result = await build().approveDraft(
        { expectedRevision: 3 },
        'reviewer'
      )
      expect(result.reviewStatus).toBe('approved')
    })

    it('request-changes loop returns to editing with a note, then resubmits', async () => {
      repo.seed([draftRow({ reviewStatus: 'in_review' })])
      const service = build()
      // Người sửa cuối cũng được yêu cầu sửa lại (quy tắc tự duyệt không áp dụng).
      const result = await service.requestChanges(
        { expectedRevision: 3, note: '  Sửa mục 2  ' },
        'editor'
      )
      expect(result.reviewStatus).toBe('editing')
      expect(draftIn()).toMatchObject({
        reviewStatus: 'editing',
        reviewNote: 'Sửa mục 2',
        reviewedBy: 'editor',
      })

      await service.submitForReview({ expectedRevision: 3 }, 'editor')
      expect(draftIn()?.['reviewStatus']).toBe('in_review')
      expect(draftIn()?.['reviewNote']).toBeUndefined()
    })

    it('request-changes requires in_review', async () => {
      repo.seed([draftRow()])
      await expect(
        build().requestChanges({ expectedRevision: 3, note: 'x' }, 'a')
      ).rejects.toThrow('TERMS_INVALID_REVIEW_STATE')
    })

    it('transition loses the race when the draft changed after the read', async () => {
      repo.seed([draftRow()])
      const service = build()
      const original = repo.findOne.bind(repo)
      repo.findOne = async (options): Promise<LegalDocumentRow | null> => {
        const found = await original(options)
        // Một lần lưu khác xen vào sau khi service đọc.
        draftIn()!['draftRevision'] = 4
        return found
      }
      await expect(
        service.submitForReview({ expectedRevision: 3 }, 'editor')
      ).rejects.toThrow('TERMS_DRAFT_STALE')
      expect(draftIn()?.['reviewStatus']).toBeUndefined()
    })
  })

  describe('publishDraft', () => {
    const approved = (
      overrides: Record<string, unknown> = {}
    ): Record<string, unknown> =>
      draftRow({
        draftRevision: 2,
        reviewStatus: 'approved',
        ...overrides,
      })

    it('rejects publishing a draft that is not approved', async () => {
      for (const reviewStatus of [undefined, 'editing', 'in_review']) {
        repo.rows = []
        repo.seed([
          publishedRow(1),
          draftRow({ draftRevision: 2, reviewStatus }),
        ])
        await expect(
          build().publishDraft({ expectedRevision: 2 }, 'admin')
        ).rejects.toThrow('TERMS_NOT_APPROVED')
        expect(draftIn()).toBeDefined()
      }
    })

    it('rejects a stale revision', async () => {
      repo.seed([publishedRow(1), approved()])
      await expect(
        build().publishDraft({ expectedRevision: 1 }, 'admin')
      ).rejects.toThrow('TERMS_DRAFT_STALE')
    })

    it('throws NotFoundException when draft does not exist', async () => {
      await expect(
        build().publishDraft({ expectedRevision: 1 }, 'admin')
      ).rejects.toThrow(NotFoundException)
    })

    it('stores a valid effectiveFrom and does not make it current yet', async () => {
      repo.seed([publishedRow(1), approved()])
      const when = new Date(Date.now() + 3 * DAY)
      const service = build()
      const result = await service.publishDraft(
        { expectedRevision: 2, effectiveFrom: when.toISOString() },
        'admin'
      )
      expect(result.version).toBe(2)
      expect(result.effectiveFrom).toEqual(when)
      expect((await service.getCurrentPublishedTerms()).version).toBe(1)
      expect((await service.getAdminState()).scheduled?.version).toBe(2)
    })

    it.each([
      [
        'in the past',
        (): string => new Date(Date.now() - 5 * 60_000).toISOString(),
      ],
      [
        'too far ahead',
        (): string => new Date(Date.now() + 366 * DAY).toISOString(),
      ],
      ['garbage', (): string => 'not-a-date'],
    ])(
      'rejects effectiveFrom %s with TERMS_EFFECTIVE_FROM_INVALID',
      async (_n: string, make: () => string) => {
        repo.seed([publishedRow(1), approved()])
        const err = await build()
          .publishDraft({ expectedRevision: 2, effectiveFrom: make() }, 'admin')
          .catch((e: unknown) => e)
        expect(err).toBeInstanceOf(BadRequestException)
        expect((err as Error).message).toBe('TERMS_EFFECTIVE_FROM_INVALID')
        expect(draftIn()).toBeDefined()
      }
    )

    it('accepts effectiveFrom within the 1 minute clock skew', async () => {
      repo.seed([publishedRow(1), approved()])
      const result = await build().publishDraft(
        {
          expectedRevision: 2,
          effectiveFrom: new Date(Date.now() - 30_000).toISOString(),
        },
        'admin'
      )
      expect(result.version).toBe(2)
    })

    it('numbers the next version after a still-scheduled one', async () => {
      repo.seed([
        publishedRow(1),
        publishedRow(2, { effectiveFrom: new Date(Date.now() + 5 * DAY) }),
        approved(),
      ])
      const result = await build().publishDraft(
        { expectedRevision: 2 },
        'admin'
      )
      expect(result.version).toBe(3)
    })

    it('returns TERMS_VERSION_CONFLICT and keeps the draft on duplicate key', async () => {
      repo.seed([publishedRow(1), approved()])
      jest.spyOn(repo, 'save').mockRejectedValue({ code: 11000 })
      await expect(
        build().publishDraft({ expectedRevision: 2 }, 'admin')
      ).rejects.toThrow('TERMS_VERSION_CONFLICT')
      expect(draftIn()).toBeDefined()
    })

    it('rethrows other save errors on publish', async () => {
      repo.seed([publishedRow(1), approved()])
      jest.spyOn(repo, 'save').mockRejectedValue(new Error('db down'))
      await expect(
        build().publishDraft({ expectedRevision: 2 }, 'admin')
      ).rejects.toThrow('db down')
    })
  })

  describe('seed text', () => {
    it('no longer mentions escrow or holding the deposit', () => {
      const text = JSON.stringify(DEFAULT_RENTAL_TERMS_FIXTURE)
      expect(text).not.toContain('ký quỹ')
      expect(text).not.toContain('giữ an toàn')
      const deposit = DEFAULT_RENTAL_TERMS_FIXTURE.sections.find(
        s => s.id === 'sec-deposit-rules'
      )
      expect(deposit?.body).toContain('Điều 328')
      expect(deposit?.body).toContain('trực tiếp cho Bên cho thuê')
      expect(deposit?.body).toContain('không giữ hộ tiền cọc')
    })
  })

  describe('seedInitialTermsIfEmpty', () => {
    it('seeds published version 1 when none exists', async () => {
      await build().seedInitialTermsIfEmpty()
      expect(repo.rows).toHaveLength(1)
      expect(repo.rows[0]).toMatchObject({
        version: 1,
        status: 'published',
        publishedBy: 'system',
      })
    })

    it('does nothing when published terms already exist', async () => {
      repo.seed([publishedRow(1)])
      await build().seedInitialTermsIfEmpty()
      expect(repo.rows).toHaveLength(1)
    })

    it('treats a duplicate key from a concurrent seed as already seeded', async () => {
      jest.spyOn(repo, 'save').mockRejectedValue({ code: 11000 })
      await expect(build().seedInitialTermsIfEmpty()).resolves.toBeUndefined()
    })

    it('rethrows other errors while seeding', async () => {
      jest.spyOn(repo, 'save').mockRejectedValue(new Error('db down'))
      await expect(build().seedInitialTermsIfEmpty()).rejects.toThrow('db down')
    })
  })

  describe('onApplicationBootstrap: stale escrow text', () => {
    const staleV1 = (
      overrides: Record<string, unknown> = {}
    ): Record<string, unknown> =>
      publishedRow(1, {
        publishedBy: 'system',
        sections: [
          {
            id: 'sec-deposit-rules',
            heading: '2',
            body: 'Tiền cọc được giữ trên tài khoản chỉ định hoặc hệ thống ký quỹ cho đến khi...',
            order: 1,
          },
        ],
        ...overrides,
      })

    it('creates one corrected system draft for the stale system-published terms', async () => {
      repo.seed([staleV1()])
      const service = build()
      await service.onApplicationBootstrap()

      const drafts = repo.rows.filter(r => r['status'] === 'draft')
      expect(drafts).toHaveLength(1)
      expect(drafts[0]).toMatchObject({
        kind: 'terms',
        reviewStatus: 'editing',
        createdBy: 'system',
        draftRevision: 1,
        version: 0,
      })
      expect(JSON.stringify(drafts[0]?.['sections'])).not.toContain('ký quỹ')
      expect(drafts[0]?.['sections']).toEqual(
        DEFAULT_RENTAL_TERMS_FIXTURE.sections
      )
      // v1 đã công bố không bị đụng.
      expect(repo.rows.find(r => r['version'] === 1)).toMatchObject(staleV1())

      // Idempotent: lần khởi động tiếp theo không tạo thêm.
      await service.onApplicationBootstrap()
      expect(repo.rows.filter(r => r['status'] === 'draft')).toHaveLength(1)
    })

    it('does not create a draft when a draft already exists', async () => {
      repo.seed([staleV1(), draftRow()])
      await build().onApplicationBootstrap()
      expect(repo.rows.filter(r => r['status'] === 'draft')).toHaveLength(1)
      expect(draftIn()?.['createdBy']).toBe('editor')
    })

    it('does not create a draft when the latest version was published by a human', async () => {
      repo.seed([staleV1({ publishedBy: 'admin-1' })])
      await build().onApplicationBootstrap()
      expect(draftIn()).toBeUndefined()
    })

    it('does not create a draft when the latest published terms no longer mention escrow', async () => {
      repo.seed([staleV1(), publishedRow(2, { publishedBy: 'system' })])
      await build().onApplicationBootstrap()
      expect(draftIn()).toBeUndefined()
    })

    it('does not create a draft for freshly seeded corrected terms', async () => {
      await build().onApplicationBootstrap()
      expect(repo.rows).toHaveLength(1)
      expect(draftIn()).toBeUndefined()
    })

    it('seed hash matches the canonical hash of the fixture', async () => {
      await build().seedInitialTermsIfEmpty()
      expect(repo.rows[0]?.['contentHash']).toBe(
        computeCanonicalTermsHash({
          key: RENTAL_TERMS_KEY,
          version: 1,
          title: DEFAULT_RENTAL_TERMS_FIXTURE.title,
          summary: DEFAULT_RENTAL_TERMS_FIXTURE.summary,
          sections: DEFAULT_RENTAL_TERMS_FIXTURE.sections,
        })
      )
    })
  })
})
