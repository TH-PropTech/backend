import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { RecommendationsService } from './recommendations.service'
import { NaiveBayesEngine } from '../engine/naive-bayes.engine'
import { ApartmentsService } from '../../services/apartments.service'
import { RecommendationHistory } from '../schemas/recommendation-history.schema'
import { ActivityLog } from '../../../activity-log/schemas/activity-log.schema'
import { Apartment } from '../../schemas/apartment.schema'
import { RecommendDto } from '../dto/recommend.dto'
import { FeedbackDto, FeedbackType } from '../dto/feedback.dto'
import { RecommendationConfigService } from './recommendation-config.service'
import { ObjectId } from 'mongodb'

describe('RecommendationsService', () => {
  let service: RecommendationsService
  let mockHistoryRepo: {
    find: jest.Mock
    count: jest.Mock
    countBy: jest.Mock
    create: jest.Mock
    save: jest.Mock
  }
  let mockApartmentsService: {
    findAll: jest.Mock
  }
  let mockConfigService: {
    getConfig: jest.Mock
    updateConfig: jest.Mock
  }
  let nbEngine: NaiveBayesEngine

  const mockApartments: Apartment[] = [
    {
      _id: new ObjectId('60d5ec4b8f72a43b64f78e41'),
      title: 'Vinhomes Central Park',
      buildingId: 'b1',
      buildingName: 'Vinhomes Central Park',
      projectId: 'p1',
      projectName: 'Vinhomes',
      category: 'Chung cư cao cấp',
      description: 'Căn hộ view sông',
      location: 'Bình Thạnh, TP.HCM',
      city: 'TP.HCM',
      district: 'Bình Thạnh',
      ward: 'Phường 22',
      street: 'Nguyễn Hữu Cảnh',
      address: '208 Nguyễn Hữu Cảnh',
      priceMonthly: 18_000_000,
      area: 75,
      bedrooms: 2,
      bathrooms: 2,
      direction: 'Đông Nam',
      balconyDirection: 'Đông',
      furniture: 'Đầy đủ',
      moveInTime: 'Ngay',
      electricity: 'Nhà nước',
      water: 'Nhà nước',
      internet: 'FPT',
      gallery: ['https://example.com/vinhomes.jpg'],
      images360: [],
      vrUrl: '',
      amenities: ['Gym', 'Bể bơi', 'Bãi đỗ xe ô tô'],
      status: 'available',
      isVerified: true,
      landlordId: 'user1',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      _id: new ObjectId('60d5ec4b8f72a43b64f78e42'),
      title: 'Masteri Thảo Điền',
      buildingId: 'b2',
      buildingName: 'Masteri Thảo Điền',
      projectId: 'p2',
      projectName: 'Masteri',
      category: 'Chung cư cao cấp',
      description: 'Căn hộ view xa lộ',
      location: 'Quận 2, TP.HCM',
      city: 'TP.HCM',
      district: 'Quận 2',
      ward: 'Thảo Điền',
      street: 'Xa Lộ Hà Nội',
      address: '159 Xa Lộ Hà Nội',
      priceMonthly: 16_000_000,
      area: 68,
      bedrooms: 2,
      bathrooms: 2,
      direction: 'Đông',
      balconyDirection: 'Nam',
      furniture: 'Đầy đủ',
      moveInTime: 'Ngay',
      electricity: 'Nhà nước',
      water: 'Nhà nước',
      internet: 'Viettel',
      gallery: ['https://example.com/masteri.jpg'],
      images360: [],
      vrUrl: '',
      amenities: ['Gym', 'Bãi đỗ xe'],
      status: 'available',
      isVerified: true,
      landlordId: 'user2',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  const mockHistories: RecommendationHistory[] = [
    {
      _id: new ObjectId(),
      userAge: 28,
      userIncome: 50_000_000,
      preferredDistrict: 'Bình Thạnh',
      preferredBedrooms: 2,
      requiresGym: 1,
      requiresParking: 1,
      rentedApartmentId: '60d5ec4b8f72a43b64f78e41',
      satisfactionScore: 5.0,
      createdAt: new Date(),
    },
  ]

  beforeEach(async () => {
    mockHistoryRepo = {
      find: jest.fn().mockResolvedValue(mockHistories),
      count: jest.fn().mockResolvedValue(mockHistories.length),
      countBy: jest.fn().mockResolvedValue(mockHistories.length),
      create: jest
        .fn()
        .mockImplementation(
          (dto: Partial<RecommendationHistory>): RecommendationHistory =>
            dto as RecommendationHistory
        ),
      save: jest
        .fn()
        .mockImplementation(
          (entity: RecommendationHistory): Promise<RecommendationHistory> =>
            Promise.resolve(entity)
        ),
    }

    mockApartmentsService = {
      findAll: jest.fn().mockResolvedValue(mockApartments),
    }

    mockConfigService = {
      getConfig: jest.fn().mockResolvedValue({
        configId: 'global',
        strategy: 'hybrid',
        alpha: 1.0,
        nbWeight: 0.5,
        ruleWeight: 0.5,
      }),
      updateConfig: jest.fn(),
    }

    nbEngine = new NaiveBayesEngine()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecommendationsService,
        {
          provide: getRepositoryToken(ActivityLog),
          useValue: mockHistoryRepo,
        },
        {
          provide: ApartmentsService,
          useValue: mockApartmentsService,
        },
        {
          provide: NaiveBayesEngine,
          useValue: nbEngine,
        },
        {
          provide: RecommendationConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile()

    service = module.get<RecommendationsService>(RecommendationsService)
  })

  describe('Dimension 1: Happy Path (recommend & bootstrap)', () => {
    it('should initialize and retrain model on application bootstrap', async () => {
      await service.onApplicationBootstrap()
      expect(mockApartmentsService.findAll).toHaveBeenCalled()
      expect(mockHistoryRepo.find).toHaveBeenCalledWith({
        where: { kind: 'recommendation' },
      })
    })

    it('should generate recommendations accurately using native engine', async () => {
      const dto: RecommendDto = {
        age: 28,
        income: 50_000_000,
        preferred_district: 'Bình Thạnh',
        rooms: 2,
        has_gym: true,
        has_parking: true,
      }

      const results = await service.recommend(dto)
      expect(results.length).toBeGreaterThan(0)
      const topResult = results[0]
      expect(topResult).toBeDefined()
      if (!topResult) return
      expect(topResult.id).toBe('60d5ec4b8f72a43b64f78e41')
      expect(topResult.match_score).toBeGreaterThan(50)
      expect(topResult.reasons.length).toBeGreaterThan(0)
      expect(topResult.contributions).toBeDefined()
    })
  })

  describe('Dimension 2: Boundary & Edge Cases', () => {
    it('should handle bootstrap gracefully when apartments or history query fails', async () => {
      mockApartmentsService.findAll.mockRejectedValueOnce(
        new Error('DB Connection Refused')
      )
      // Should not throw and catch inside onApplicationBootstrap
      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined()
    })

    it('should return empty recommendations when no apartment matches budget', async () => {
      const dto: RecommendDto = {
        age: 20,
        income: 5_000_000, // 50% = 2.5M, cheapest is 16M
        preferred_district: 'Bình Thạnh',
        rooms: 1,
        has_gym: false,
        has_parking: false,
      }

      const results = await service.recommend(dto)
      expect(results).toEqual([])
    })
  })

  describe('Dimension 3: Feedback (Like & Dislike online learning)', () => {
    it('should handle positive feedback (like) by saving to DB and retraining on-the-fly', async () => {
      const dto: FeedbackDto = {
        building_id: '60d5ec4b8f72a43b64f78e41',
        age: 28,
        income: 50_000_000,
        preferred_district: 'Bình Thạnh',
        rooms: 2,
        has_gym: true,
        has_parking: true,
        feedback_type: FeedbackType.LIKE,
      }

      const res = await service.feedback(dto)
      expect(mockHistoryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'recommendation',
          userAge: 28,
          userIncome: 50_000_000,
          preferredDistrict: 'Bình Thạnh',
          preferredBedrooms: 2,
          requiresGym: 1,
          requiresParking: 1,
          rentedApartmentId: '60d5ec4b8f72a43b64f78e41',
        })
      )
      expect(res.status).toBe('success')
      expect(res.message).toContain('recorded successfully')
    })

    it('should handle negative feedback (dislike) without inserting into training data', async () => {
      const dto: FeedbackDto = {
        building_id: '60d5ec4b8f72a43b64f78e42',
        age: 28,
        income: 50_000_000,
        preferred_district: 'Quận 2',
        rooms: 2,
        has_gym: true,
        has_parking: true,
        feedback_type: FeedbackType.DISLIKE,
      }

      const res = await service.feedback(dto)
      expect(mockHistoryRepo.create).not.toHaveBeenCalled()
      expect(res.status).toBe('success')
      expect(res.message).toContain("Feedback 'dislike' recorded successfully")
    })
  })

  describe('Dimension 4: Sync & Admin Actions', () => {
    it('should sync apartments and retrain model', async () => {
      const res = await service.sync()
      expect(res.status).toBe('success')
      expect(res.apartments_loaded).toBe(2)
    })
  })

  describe('Dimension 5: Engine Config & Fallback Handling', () => {
    it('should retrain model with active config from configService', async () => {
      mockConfigService.getConfig.mockResolvedValueOnce({
        configId: 'global',
        strategy: 'map',
        alpha: 2.5,
        nbWeight: 0.6,
        ruleWeight: 0.4,
      })

      const res = await service.retrainModel()
      expect(mockConfigService.getConfig).toHaveBeenCalled()
      expect(res.buildingCount).toBe(2)
      expect(nbEngine.getConfig().strategy).toBe('map')
      expect(nbEngine.getConfig().alpha).toBe(2.5)
    })

    it('should fallback to default hybrid config if configService.getConfig throws error', async () => {
      mockConfigService.getConfig.mockRejectedValueOnce(
        new Error('Database connection failed')
      )

      const res = await service.retrainModel()
      expect(res.buildingCount).toBe(2)
      expect(nbEngine.getConfig().strategy).toBe('hybrid')
      expect(nbEngine.getConfig().alpha).toBe(1.0)
      expect(nbEngine.getConfig().nbWeight).toBe(0.5)
      expect(nbEngine.getConfig().ruleWeight).toBe(0.5)
    })
  })
})
