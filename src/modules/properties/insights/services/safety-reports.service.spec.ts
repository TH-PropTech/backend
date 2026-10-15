import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { SafetyReportsService } from './safety-reports.service'
import type { SafetyReport } from '../schemas/safety-report.schema'
import type { ReviewCase } from '../../schemas/review-case.schema'
import type { NotificationsService } from '../../../notifications/services/notifications.service'
import type { ApartmentsService } from '../../services/apartments.service'
import { SafetyReportQueryDto } from '../dto/safety-report-query.dto'

type ReportRepositoryMock = {
  create: jest.Mock<ReviewCase, [Partial<ReviewCase>]>
  find: jest.Mock<Promise<ReviewCase[]>, [unknown?]>
  findOne: jest.Mock<Promise<ReviewCase | null>, [unknown?]>
  save: jest.Mock<Promise<ReviewCase>, [ReviewCase]>
}

/** Khớp `where` đơn giản như Mongo: mọi khóa phải bằng nhau (ObjectId so theo equals). */
function matchesWhere(
  row: object,
  where: Record<string, unknown> = {}
): boolean {
  const record = row as Record<string, unknown>
  return Object.entries(where).every(([key, expected]) => {
    const actual = record[key]
    if (expected instanceof ObjectId && actual instanceof ObjectId) {
      return actual.equals(expected)
    }
    return actual === expected
  })
}

function createReport(overrides: Partial<ReviewCase> = {}): ReviewCase {
  return {
    _id: new ObjectId(),
    kind: 'safety',
    reporterId: 'tenant-1',
    reporterRole: 'tenant',
    targetType: 'listing',
    targetId: new ObjectId().toString(),
    targetTitle: 'Apartment',
    category: 'fake_listing',
    description: 'The listing information is fraudulent.',
    evidenceUrls: [],
    riskLevel: 'high',
    status: 'pending',
    isTargetHidden: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

/** Bản ghi của hàng đợi listing nằm chung collection review_cases (kind khác). */
function createListingCase(overrides: Partial<ReviewCase> = {}): ReviewCase {
  return {
    _id: new ObjectId(),
    kind: 'listing',
    apartmentId: new ObjectId().toString(),
    relatedApartmentId: new ObjectId().toString(),
    type: 'duplicate_photo',
    confidence: 1,
    evidence: 'Một URL ảnh trùng khớp',
    status: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date('2026-09-02T00:00:00.000Z'),
    updatedAt: new Date('2026-09-02T00:00:00.000Z'),
    ...overrides,
  }
}

describe('SafetyReportsService', () => {
  let repository: ReportRepositoryMock
  const notificationsService = {
    createNotification: jest.fn().mockResolvedValue(undefined),
  }
  const apartmentsService = {
    updateStatus: jest.fn().mockResolvedValue(undefined),
  }
  let service: SafetyReportsService

  beforeEach(() => {
    jest.clearAllMocks()
    repository = {
      create: jest.fn(value => value as ReviewCase),
      find: jest.fn<Promise<ReviewCase[]>, [unknown?]>(),
      findOne: jest.fn<Promise<ReviewCase | null>, [unknown?]>(),
      save: jest.fn<Promise<ReviewCase>, [ReviewCase]>(value =>
        Promise.resolve(value)
      ),
    }
    service = new SafetyReportsService(
      repository as unknown as Repository<ReviewCase>,
      notificationsService as unknown as NotificationsService,
      apartmentsService as unknown as ApartmentsService
    )
  })

  it('assigns category risk, persists the report, and notifies staff', async () => {
    const report = await service.createReport('tenant-1', 'tenant', {
      targetType: 'listing',
      targetId: new ObjectId().toString(),
      category: 'external_payment',
      description: 'The landlord asked for an off-platform transfer.',
    })

    expect(report.riskLevel).toBe('critical')
    expect(report.status).toBe('pending')
    expect(report).not.toHaveProperty('kind')
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'safety' })
    )
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      'staff',
      expect.any(String),
      expect.any(String),
      'SAFETY_REPORT',
      expect.objectContaining({ riskLevel: 'critical' })
    )
  })

  it('removes investigation-only fields from reporter history', async () => {
    repository.find.mockResolvedValue([
      createReport({
        assignedTo: 'staff-1',
        assignedAt: new Date(),
        resolutionNote: 'Internal investigation detail',
      }),
    ])

    const result = await service.getMyReports(
      'tenant-1',
      new SafetyReportQueryDto()
    )

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kind: 'safety', reporterId: 'tenant-1' },
      })
    )
    expect(result.items[0]).not.toHaveProperty('assignedTo')
    expect(result.items[0]).not.toHaveProperty('assignedAt')
    expect(result.items[0]).not.toHaveProperty('resolutionNote')
    expect(result.items[0]).not.toHaveProperty('kind')
  })

  it('filters reporter history by status and category inside the safety kind', async () => {
    repository.find.mockResolvedValue([])
    const query = new SafetyReportQueryDto()
    query.status = 'resolved'
    query.category = 'spam'

    await service.getMyReports('tenant-1', query)

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          kind: 'safety',
          reporterId: 'tenant-1',
          status: 'resolved',
          category: 'spam',
        },
      })
    )
  })

  it('keeps listing review cases out of the reporter history and the moderation queue', async () => {
    const rows: ReviewCase[] = [
      createReport({ reporterId: 'tenant-1', status: 'pending' }),
      createListingCase({ status: 'pending' }),
      createReport({ reporterId: 'tenant-1', status: 'resolved' }),
      createReport({ reporterId: 'tenant-2', status: 'pending' }),
    ]
    repository.find.mockImplementation(options => {
      const where = (options as { where?: Record<string, unknown> } | undefined)
        ?.where
      return Promise.resolve(rows.filter(row => matchesWhere(row, where)))
    })

    const mine = await service.getMyReports(
      'tenant-1',
      new SafetyReportQueryDto()
    )
    expect(mine.total).toBe(2)
    for (const item of mine.items) expect(item).not.toHaveProperty('kind')

    const queue = await service.getReportQueue(new SafetyReportQueryDto())
    expect(queue.total).toBe(3)
    const pending = new SafetyReportQueryDto()
    pending.status = 'pending'
    const pendingQueue = await service.getReportQueue(pending)
    expect(pendingQueue.total).toBe(2)
    expect(
      pendingQueue.items.every(item => item.targetType === 'listing')
    ).toBe(true)
  })

  it('looks up a report by id only among safety rows', async () => {
    const report = createReport()
    repository.findOne.mockResolvedValue(report)

    await service.getReportById(report._id.toString())

    const [lookup] = repository.findOne.mock.calls[0] as [
      { where: Record<string, unknown> },
    ]
    expect(lookup.where).toMatchObject({ kind: 'safety', _id: report._id })
  })

  it('temporarily hides the actual apartment for a high-risk listing report', async () => {
    const report = createReport()
    repository.findOne.mockResolvedValue(report)

    const result = await service.hideTarget(report._id.toString(), 'staff-1')

    expect(apartmentsService.updateStatus).toHaveBeenCalledWith(
      report.targetId,
      'unavailable',
      false
    )
    expect(result.isTargetHidden).toBe(true)
    expect(result.assignedTo).toBe('staff-1')
    expect(result).not.toHaveProperty('kind')
  })

  it('does not hide a listing from a low-risk report', async () => {
    const report = createReport({ riskLevel: 'low', category: 'spam' })
    repository.findOne.mockResolvedValue(report)

    await expect(
      service.hideTarget(report._id.toString(), 'staff-1')
    ).rejects.toThrow(BadRequestException)
    expect(apartmentsService.updateStatus).not.toHaveBeenCalled()
  })

  it('does not hide targets that are not listings', async () => {
    const report = createReport({ targetType: 'user' })
    repository.findOne.mockResolvedValue(report)

    await expect(
      service.hideTarget(report._id.toString(), 'staff-1')
    ).rejects.toThrow(BadRequestException)
  })

  it('allows only the original reporter to appeal a completed decision', async () => {
    const report = createReport({ status: 'resolved' })
    repository.findOne.mockResolvedValue(report)

    await expect(
      service.appealReport(report._id.toString(), 'tenant-2', {
        appealReason: 'Please review this again.',
      })
    ).rejects.toThrow(ForbiddenException)

    const appealed = await service.appealReport(
      report._id.toString(),
      report.reporterId as string,
      { appealReason: 'Please review this again.' }
    )
    expect(appealed.status).toBe('appealed')
    expect(appealed.appealedAt).toBeInstanceOf(Date)
    expect(appealed).not.toHaveProperty('kind')
  })

  it('rejects an appeal while moderation is still pending', async () => {
    const report = createReport({ status: 'pending' })
    repository.findOne.mockResolvedValue(report)

    await expect(
      service.appealReport(report._id.toString(), report.reporterId as string, {
        appealReason: 'Please review this again.',
      })
    ).rejects.toThrow(BadRequestException)
  })

  it('exposes the same report shape as before (no kind, no listing-only fields)', async () => {
    const report = createReport({ status: 'investigating' })
    repository.findOne.mockResolvedValue(report)

    const result: SafetyReport = await service.getReportById(
      report._id.toString()
    )

    expect(result).not.toHaveProperty('kind')
    expect(result).not.toHaveProperty('apartmentId')
    expect(result).toMatchObject({
      status: 'investigating',
      category: 'fake_listing',
    })
  })
})
