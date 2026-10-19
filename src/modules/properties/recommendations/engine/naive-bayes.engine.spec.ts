import { NaiveBayesEngine } from './naive-bayes.engine'
import {
  ApartmentRecord,
  TrainingRecord,
  UserProfile,
} from './naive-bayes.types'

describe('NaiveBayesEngine', () => {
  let engine: NaiveBayesEngine

  const mockApartments: ApartmentRecord[] = [
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
      engine.train(mockApartments, mockHistory)

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

    it('should filter out apartments whose rent exceeds 50% of monthly income (hard constraint)', () => {
      engine.train(mockApartments, mockHistory)

      const profile: UserProfile = {
        age: 25,
        income: 8_000_000, // 50% = 4,000,000. All apartments rent >= 5M
        preferred_district: 'Bình Tân',
        rooms: 1,
        has_gym: false,
        has_parking: false,
      }

      const results = engine.recommend(profile)
      expect(results).toEqual([])
    })

    it('should handle training with empty apartments array gracefully', () => {
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
      engine.train(mockApartments, [])
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

    it('should identify newly added districts in the expanded DISTRICT_NEIGHBORS map', () => {
      // Task 2.2: verify new quận/huyện entries
      expect(engine.isNeighbor('Quận 12', 'Gò Vấp')).toBe(true)
      expect(engine.isNeighbor('Quận 5', 'Quận 6')).toBe(true)
      expect(engine.isNeighbor('Hóc Môn', 'Bình Chánh')).toBe(true)
      expect(engine.isNeighbor('Nhà Bè', 'Quận 7')).toBe(true)
      // Củ Chi only neighbors Hóc Môn
      expect(engine.isNeighbor('Củ Chi', 'Quận 1')).toBe(false)
      expect(engine.isNeighbor('Củ Chi', 'Hóc Môn')).toBe(true)
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
      engine.train(mockApartments, mockHistory)

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
      engine.train(mockApartments, mockHistory)

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

  describe('Dimension 6: Normalized Location Score & Confidence Ratio', () => {
    it('should keep contributions.location in [0,100] for exact district match (denominator fix)', () => {
      // Task 1.3: denominator changed from 45 to 30; exact match = 30pts → 100%
      engine.train(mockApartments, mockHistory)

      const profile: UserProfile = {
        age: 28,
        income: 50_000_000,
        preferred_district: 'Bình Thạnh',
        rooms: 2,
        has_gym: true,
        has_parking: true,
      }

      const results = engine.recommend(profile, 5)
      const b1 = results.find(r => r.id === 'b1')
      expect(b1).toBeDefined()
      expect(b1?.contributions.location).toBeGreaterThanOrEqual(0)
      expect(b1?.contributions.location).toBeLessThanOrEqual(100)
      // Exact match: 30/30 * 100 = 100
      expect(b1?.contributions.location).toBe(100)
    })

    it('should compute ratio-based confidence: ≥5% of total history → Cao', () => {
      // Task 3.2: b1 has 2 records out of 4 total = 50% → Cao
      engine.train(mockApartments, mockHistory)

      const profile: UserProfile = {
        age: 28,
        income: 50_000_000,
        preferred_district: 'Bình Thạnh',
        rooms: 2,
        has_gym: true,
        has_parking: true,
      }

      const results = engine.recommend(profile, 5)
      const b1 = results.find(r => r.id === 'b1')
      expect(b1).toBeDefined()
      expect(b1?.confidence).toBe('Cao')
    })

    it('should return Thấp confidence when total history is empty', () => {
      // Task 3.2: zero history → ratio = 0 → Thấp
      engine.train(mockApartments, [])

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
      for (const r of results) {
        expect(r.confidence).toBe('Thấp')
      }
    })

    it('should return Thấp confidence when apartment ratio < 1% of total history', () => {
      // Task 3.2: b3 has 1 record; if total is large, ratio < 1% → Thấp
      // Simulate with many extra records for other apartments
      const extraHistory = Array.from({ length: 200 }, (_, i) => ({
        user_age: 28 + (i % 10),
        user_income: 50_000_000,
        preferred_district: 'Bình Thạnh',
        preferred_bedrooms: 2,
        requires_gym: 1,
        requires_parking: 1,
        rented_apartment_id: 'b1',
      }))
      engine.train(mockApartments, [...mockHistory, ...extraHistory])
      // b3 has 1 record out of 204 total ≈ 0.49% < 1% → Thấp

      const profile: UserProfile = {
        age: 22,
        income: 20_000_000,
        preferred_district: 'Bình Tân',
        rooms: 1,
        has_gym: false,
        has_parking: false,
      }

      const results = engine.recommend(profile, 5)
      const b3 = results.find(r => r.id === 'b3')
      expect(b3).toBeDefined()
      expect(b3?.confidence).toBe('Thấp')
    })
  })

  describe('Engine Strategy Pattern & Configuration', () => {
    it('should default to hybrid strategy with alpha=1.0 and 50/50 weights', () => {
      engine.train(mockApartments, mockHistory)
      const config = engine.getConfig()
      expect(config.strategy).toBe('hybrid')
      expect(config.alpha).toBe(1.0)
      expect(config.nbWeight).toBe(0.5)
      expect(config.ruleWeight).toBe(0.5)
    })

    it('should train with hybrid strategy and produce valid recommendations', () => {
      engine.train(mockApartments, mockHistory, {
        strategy: 'hybrid',
        alpha: 1.0,
        nbWeight: 0.5,
        ruleWeight: 0.5,
      })

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
      const firstResult = results[0]
      expect(firstResult).toBeDefined()
      if (!firstResult) throw new Error('Expected at least one recommendation')
      expect(firstResult.match_score).toBeGreaterThanOrEqual(0)
      expect(firstResult.match_score).toBeLessThanOrEqual(100)
    })

    it('should train with MAP strategy and use custom alpha', () => {
      engine.train(mockApartments, mockHistory, {
        strategy: 'map',
        alpha: 2.0,
        nbWeight: 0.7,
        ruleWeight: 0.3,
      })

      expect(engine.getConfig().strategy).toBe('map')
      expect(engine.getConfig().alpha).toBe(2.0)

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
    })

    it('should train with weighted strategy and compute feature weights summing to 1.0', () => {
      engine.train(mockApartments, mockHistory, {
        strategy: 'weighted',
        alpha: 1.0,
        nbWeight: 0.5,
        ruleWeight: 0.5,
      })

      const weights = engine.getFeatureWeights()
      expect(weights).toBeDefined()
      expect(weights.district).toBeGreaterThan(0)
      expect(weights.rooms).toBeGreaterThan(0)
      expect(weights.gym).toBeGreaterThan(0)
      expect(weights.parking).toBeGreaterThanOrEqual(0)

      const sum =
        weights.district + weights.rooms + weights.gym + weights.parking
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9)

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
      const firstResult = results[0]
      expect(firstResult).toBeDefined()
      if (!firstResult) throw new Error('Expected at least one recommendation')
      expect(firstResult.contributions).toBeDefined()
      expect(firstResult.confidence).toBeDefined()
    })

    it('should train with map-weighted strategy and produce complete recommendations', () => {
      engine.train(mockApartments, mockHistory, {
        strategy: 'map-weighted',
        alpha: 1.5,
        nbWeight: 0.6,
        ruleWeight: 0.4,
      })

      const weights = engine.getFeatureWeights()
      const sum =
        weights.district + weights.rooms + weights.gym + weights.parking
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9)

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
    })

    it('should assign uniform 0.25 weights when history is empty', () => {
      engine.train(mockApartments, [], {
        strategy: 'weighted',
        alpha: 1.0,
        nbWeight: 0.5,
        ruleWeight: 0.5,
      })

      const weights = engine.getFeatureWeights()
      expect(weights.district).toBe(0.25)
      expect(weights.rooms).toBe(0.25)
      expect(weights.gym).toBe(0.25)
      expect(weights.parking).toBe(0.25)
    })
  })
})
