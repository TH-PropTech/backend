import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { ApartmentsService } from '../apartments/apartments.service'
import { ConditionAnalysisService } from './condition-analysis.service'
import { GroqVisionService } from './groq-vision.service'
import { ConditionAnalysis } from './schemas/condition-analysis.schema'

describe('ConditionAnalysisService', () => {
  const apartmentId = new ObjectId().toString()
  const analysisId = new ObjectId()
  const repository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  }
  const groqVisionService = { analyzeCondition: jest.fn() }
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('https://app.example.com'),
  }
  const apartmentsService = { findOne: jest.fn() }

  let service: ConditionAnalysisService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new ConditionAnalysisService(
      repository as unknown as Repository<ConditionAnalysis>,
      groqVisionService as unknown as GroqVisionService,
      configService as unknown as ConfigService,
      apartmentsService as unknown as ApartmentsService
    )
  })

  it('stores a private analysis only after apartment and provider success', async () => {
    const result = {
      findings: [],
      overallCondition: 'good' as const,
      checklist: [],
      model: 'test-model',
    }
    apartmentsService.findOne.mockResolvedValue({
      _id: new ObjectId(apartmentId),
    })
    groqVisionService.analyzeCondition.mockResolvedValue(result)
    repository.create.mockImplementation((value: unknown) => value)
    repository.save.mockImplementation((value: unknown) =>
      Promise.resolve(value)
    )

    const saved = await service.analyze('user-1', {
      apartmentId,
      imageStorageKey: 'private-key',
      image: Buffer.from('image'),
      mimeType: 'image/jpeg',
    })

    expect(saved.userId).toBe('user-1')
    expect(saved.isPrivate).toBe(true)
    expect(saved.imageUrl).toContain('/condition-analyses/')
    expect(repository.save).toHaveBeenCalledTimes(1)
  })

  it('does not persist when the provider fails', async () => {
    apartmentsService.findOne.mockResolvedValue({
      _id: new ObjectId(apartmentId),
    })
    groqVisionService.analyzeCondition.mockRejectedValue(
      new Error('provider down')
    )

    await expect(
      service.analyze('user-1', {
        apartmentId,
        imageStorageKey: 'private-key',
        image: Buffer.from('image'),
        mimeType: 'image/jpeg',
      })
    ).rejects.toThrow('provider down')
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('lists only the current user and optional apartment scope', async () => {
    repository.find.mockResolvedValue([])

    await service.listMine('user-1', apartmentId)

    expect(repository.find).toHaveBeenCalledWith({
      where: { userId: 'user-1', apartmentId },
      order: { createdAt: 'DESC' },
    })
  })

  it('rejects invalid, missing, and foreign analysis identifiers', async () => {
    await expect(service.getMine('bad-id', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException
    )

    repository.findOne.mockResolvedValue(null)
    await expect(
      service.getMine(analysisId.toString(), 'user-1')
    ).rejects.toBeInstanceOf(NotFoundException)

    repository.findOne.mockResolvedValue({ _id: analysisId, userId: 'user-2' })
    await expect(
      service.getMine(analysisId.toString(), 'user-1')
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
