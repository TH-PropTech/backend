import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { SafetyReportsService } from './safety-reports.service'
import type { SafetyReport } from './schemas/safety-report.schema'
import type { NotificationsService } from '../notifications/notifications.service'
import type { ApartmentsService } from '../apartments/apartments.service'
import { SafetyReportQueryDto } from './dto/safety-report-query.dto'

type ReportRepositoryMock = {
  create: jest.Mock<SafetyReport, [Partial<SafetyReport>]>
  find: jest.Mock<Promise<SafetyReport[]>, [unknown?]>
  findOne: jest.Mock<Promise<SafetyReport | null>, [unknown?]>
  save: jest.Mock<Promise<SafetyReport>, [SafetyReport]>
}

function createReport(overrides: Partial<SafetyReport> = {}): SafetyReport {
  return {
    _id: new ObjectId(),
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
      create: jest.fn(value => value as SafetyReport),
      find: jest.fn<Promise<SafetyReport[]>, [unknown?]>(),
      findOne: jest.fn<Promise<SafetyReport | null>, [unknown?]>(),
      save: jest.fn<Promise<SafetyReport>, [SafetyReport]>(value =>
        Promise.resolve(value)
      ),
    }
    service = new SafetyReportsService(
      repository as unknown as Repository<SafetyReport>,
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

    expect(result.items[0]).not.toHaveProperty('assignedTo')
    expect(result.items[0]).not.toHaveProperty('assignedAt')
    expect(result.items[0]).not.toHaveProperty('resolutionNote')
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
      report.reporterId,
      { appealReason: 'Please review this again.' }
    )
    expect(appealed.status).toBe('appealed')
    expect(appealed.appealedAt).toBeInstanceOf(Date)
  })

  it('rejects an appeal while moderation is still pending', async () => {
    const report = createReport({ status: 'pending' })
    repository.findOne.mockResolvedValue(report)

    await expect(
      service.appealReport(report._id.toString(), report.reporterId, {
        appealReason: 'Please review this again.',
      })
    ).rejects.toThrow(BadRequestException)
  })
})
