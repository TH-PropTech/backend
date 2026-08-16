import { Test, TestingModule } from '@nestjs/testing'
import { RecommendationsController } from './recommendations.controller'
import { RecommendationsService } from './recommendations.service'
import { RecommendDto } from './dto/recommend.dto'
import { FeedbackDto, FeedbackType } from './dto/feedback.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import {
  RecommendationResult,
  FeedbackResponse,
  SyncResponse,
} from './interfaces/recommendation.interface'

describe('RecommendationsController', () => {
  let controller: RecommendationsController

  const mockRecommendations: RecommendationResult[] = [
    {
      id: 'apt1',
      name: 'Vinhomes Central Park',
      district: 'Bình Thạnh',
      rent_price: 18_000_000,
      rooms: 2,
      has_gym: true,
      has_parking: true,
      image_url: 'https://example.com/vinhomes.jpg',
      match_score: 92.5,
      reasons: ['Giá thuê chỉ chiếm 36% thu nhập', 'Đúng Bình Thạnh đã chọn'],
      confidence: 'Cao',
      contributions: {
        finance: 85,
        location: 100,
        demographics: 80,
        amenities: 100,
      },
    },
  ]

  const mockService = {
    recommend: jest
      .fn<Promise<RecommendationResult[]>, [RecommendDto]>()
      .mockResolvedValue(mockRecommendations),
    feedback: jest
      .fn<Promise<FeedbackResponse>, [FeedbackDto]>()
      .mockResolvedValue({
        status: 'success',
        message: 'Feedback recorded successfully.',
        history_records: 100,
      }),
    sync: jest.fn<Promise<SyncResponse>, []>().mockResolvedValue({
      status: 'success',
      message: 'Apartment data synced and model retrained successfully',
      apartments_loaded: 25,
    }),
  }

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecommendationsController],
      providers: [
        {
          provide: RecommendationsService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get<RecommendationsController>(
      RecommendationsController
    )
  })

  it('should call service.recommend and return recommendation results', async () => {
    const dto: RecommendDto = {
      age: 28,
      income: 50_000_000,
      preferred_district: 'Bình Thạnh',
      rooms: 2,
      has_gym: true,
      has_parking: true,
    }

    const result = await controller.recommend(dto)
    expect(mockService.recommend).toHaveBeenCalledWith(dto)
    expect(result).toEqual(mockRecommendations)
  })

  it('should call service.feedback and return feedback response', async () => {
    const dto: FeedbackDto = {
      building_id: 'apt1',
      age: 28,
      income: 50_000_000,
      preferred_district: 'Bình Thạnh',
      rooms: 2,
      has_gym: true,
      has_parking: true,
      feedback_type: FeedbackType.LIKE,
    }

    const result = await controller.feedback(dto)
    expect(mockService.feedback).toHaveBeenCalledWith(dto)
    expect(result.status).toBe('success')
  })

  it('should call service.sync and return sync response', async () => {
    const result = await controller.sync()
    expect(mockService.sync).toHaveBeenCalled()
    expect(result.status).toBe('success')
    expect(result.apartments_loaded).toBe(25)
  })
})
