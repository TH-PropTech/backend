import { NaiveBayesEngine } from './naive-bayes.engine'
import {
  BuildingRecord,
  TrainingRecord,
  UserProfile,
} from './naive-bayes.types'

describe('NaiveBayesEngine', () => {
  let engine: NaiveBayesEngine

  const mockBuildings: BuildingRecord[] = [
    {
      id: 'b1',
      name: 'Vinhomes Central Park',
      district: 'Bình Thạnh',
      rent_price: 18_000_000,
      min_income: 45_000_000,
      target_age_min: 25,
      target_age_max: 45,
      rooms: 2,
      has_gym: 1,
      has_parking: 1,
      image_url: 'vinhomes.jpg',
    },
    {
      id: 'b2',
      name: 'Masteri Thảo Điền',
      district: 'Quận 2',
      rent_price: 16_000_000,
      min_income: 40_000_000,
      target_age_min: 24,
      target_age_max: 40,
      rooms: 2,
      has_gym: 1,
      has_parking: 1,
      image_url: 'masteri.jpg',
    },
    {
      id: 'b3',
      name: 'Chung cư Lê Thành',
      district: 'Bình Tân',
      rent_price: 5_000_000,
      min_income: 12_000_000,
      target_age_min: 20,
      target_age_max: 50,
      rooms: 1,
      has_gym: 0,
      has_parking: 1,
      image_url: 'lethanh.jpg',
    },
  ]

  const mockHistory: TrainingRecord[] = [
    {
      user_age: 28,
      user_income: 50_000_000,
      preferred_district: 'Bình Thạnh',
      preferred_bedrooms: 2,
      requires_gym: 1,
      requires_parking: 1,
      rented_apartment_id: 'b1',
    },
    {
      user_age: 30,
      user_income: 45_000_000,
      preferred_district: 'Bình Thạnh',
      preferred_bedrooms: 2,
      requires_gym: 1,
      requires_parking: 1,
      rented_apartment_id: 'b1',
    },
    {
      user_age: 27,
      user_income: 42_000_000,
      preferred_district: 'Quận 2',
      preferred_bedrooms: 2,
      requires_gym: 1,
      requires_parking: 1,
      rented_apartment_id: 'b2',
    },
    {
      user_age: 22,
      user_income: 12_000_000,
      preferred_district: 'Bình Tân',
      preferred_bedrooms: 1,
      requires_gym: 0,
      requires_parking: 1,
      rented_apartment_id: 'b3',
    },
  ]

  beforeEach(() => {
    engine = new NaiveBayesEngine()
  })

  describe('Dimension 1: Happy Path', () => {
    it('should train model and produce top recommendations with valid match scores', () => {
      engine.train(mockBuildings, mockHistory)

      const profile: UserProfile = {
        age: 28,
        income: 50_000_000,
        preferred_district: 'Bình Thạnh',
        rooms: 2,
        has_gym: true,
        has_parking: true,
      }

      const results = engine.recommend(profile, 5)

      expect(results.length).toBeGreaterThan(0)
      const topResult = results[0]
      expect(topResult).toBeDefined()
      if (!topResult) return
      expect(topResult.id).toBe('b1')
      expect(topResult.match_score).toBeGreaterThan(50)
      expect(topResult.reasons.length).toBeGreaterThan(0)
      expect(topResult.contributions).toBeDefined()
      expect(topResult.contributions.finance).toBeGreaterThanOrEqual(0)
      expect(topResult.contributions.location).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Dimension 2: Boundary & Edge Cases', () => {
    it('should return empty recommendations when engine is not trained', () => {
      const profile: UserProfile = {
        age: 25,
        income: 30_000_000,
        preferred_district: 'Quận 1',
        rooms: 1,
        has_gym: false,
        has_parking: false,
      }
      const results = engine.recommend(profile)
      expect(results).toEqual([])
    })

    it('should filter out buildings whose rent exceeds 50% of monthly income (hard constraint)', () => {
      engine.train(mockBuildings, mockHistory)

      const profile: UserProfile = {
        age: 25,
        income: 8_000_000, // 50% = 4,000,000. All buildings rent >= 5M
        preferred_district: 'Bình Tân',
        rooms: 1,
        has_gym: false,
        has_parking: false,
      }

      const results = engine.recommend(profile)
      expect(results).toEqual([])
    })

    it('should handle training with empty buildings array gracefully', () => {
      engine.train([], mockHistory)
      const results = engine.recommend({
        age: 25,
        income: 50_000_000,
        preferred_district: 'Bình Thạnh',
        rooms: 2,
        has_gym: true,
        has_parking: true,
      })
      expect(results).toEqual([])
    })

    it('should handle training with empty history array gracefully using global fallbacks', () => {
      engine.train(mockBuildings, [])
      const results = engine.recommend({
        age: 28,
        income: 50_000_000,
        preferred_district: 'Bình Thạnh',
        rooms: 2,
        has_gym: true,
        has_parking: true,
      })
      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('Dimension 3: Probability & Math Helper Functions', () => {
    it('should calculate gaussian probability accurately', () => {
      const prob = engine.gaussianProbability(30, 30, 25)
      expect(prob).toBeGreaterThan(0)
      expect(Number.isFinite(prob)).toBe(true)
    })

    it('should handle variance <= 0 in gaussian probability by falling back to 1.0', () => {
      const prob = engine.gaussianProbability(30, 30, 0)
      expect(prob).toBeGreaterThan(0)
      expect(Number.isFinite(prob)).toBe(true)
    })

    it('should calculate categorical probability with Laplace smoothing', () => {
      const stats = { counts: { 'Quận 1': 5 }, total: 10 }
      const prob = engine.categoricalProbability('Quận 1', stats, 8, 1.0)
      // (5 + 1) / (10 + 1 * 8) = 6 / 18 = 0.3333
      expect(prob).toBeCloseTo(6 / 18, 4)

      // Unseen category
      const unseenProb = engine.categoricalProbability('Quận 7', stats, 8, 1.0)
      // (0 + 1) / (10 + 1 * 8) = 1 / 18 = 0.0555
      expect(unseenProb).toBeCloseTo(1 / 18, 4)
    })
  })

  describe('Dimension 4: District Neighbors & Demographics Inference', () => {
    it('should identify neighboring districts correctly', () => {
      expect(engine.isNeighbor('Quận 1', 'Bình Thạnh')).toBe(true)
      expect(engine.isNeighbor('Quận 1', 'Quận 7')).toBe(false)
      expect(engine.isNeighbor(undefined, 'Quận 1')).toBe(false)
      expect(engine.isNeighbor('Quận 1', undefined)).toBe(false)
    })

    it('should correctly infer demographics from price tiers', () => {
      const budget = engine.inferDemographics(7_000_000)
      expect(budget.targetAgeMin).toBe(20)
      expect(budget.targetAgeMax).toBe(35)
      expect(budget.minIncome).toBe(17_500_000)

      const mid = engine.inferDemographics(14_000_000)
      expect(mid.targetAgeMin).toBe(23)
      expect(mid.targetAgeMax).toBe(45)

      const premium = engine.inferDemographics(22_000_000)
      expect(premium.targetAgeMin).toBe(25)
      expect(premium.targetAgeMax).toBe(50)

      const luxury = engine.inferDemographics(40_000_000)
      expect(luxury.targetAgeMin).toBe(28)
      expect(luxury.targetAgeMax).toBe(60)
    })
  })

  describe('Dimension 5: Full Branch Coverage (Amenities & Penalty)', () => {
    it('should handle rent ratio penalty when rent > 35% of income', () => {
      engine.train(mockBuildings, mockHistory)

      // rent is 18M, income is 40M => rentRatio = 0.45 (> 0.35)
      const profile: UserProfile = {
        age: 28,
        income: 40_000_000,
        preferred_district: 'Bình Thạnh',
        rooms: 2,
        has_gym: true,
        has_parking: true,
      }

      const results = engine.recommend(profile)
      expect(results.length).toBeGreaterThan(0)
      const vinhomes = results.find(r => r.id === 'b1')
      expect(vinhomes).toBeDefined()
      expect(
        vinhomes?.reasons.some(r => r.includes('Chi phí thuê khá cao'))
      ).toBe(true)
    })

    it('should award extra points for matching room count and amenities', () => {
      engine.train(mockBuildings, mockHistory)

      const profile1PN: UserProfile = {
        age: 22,
        income: 20_000_000,
        preferred_district: 'Bình Tân',
        rooms: 1,
        has_gym: false,
        has_parking: true,
      }

      const results = engine.recommend(profile1PN)
      const lethanh = results.find(r => r.id === 'b3')
      expect(lethanh).toBeDefined()
      expect(lethanh?.reasons.some(r => r.includes('1PN riêng tư'))).toBe(true)
    })
  })
})
