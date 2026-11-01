/* eslint-disable @typescript-eslint/unbound-method -- jest mock assertions */
import { FavoritesController } from './favorites.controller'
import type { FavoritesService } from '../services/favorites.service'
import type { Apartment } from '../schemas/apartment.schema'
import { ObjectId } from 'mongodb'

describe('FavoritesController', () => {
  let controller: FavoritesController
  let favoritesService: jest.Mocked<FavoritesService>

  const userId = 'user-test-123'
  const aptId = new ObjectId().toHexString()

  beforeEach(() => {
    favoritesService = {
      getFavorites: jest.fn(),
      addFavorite: jest.fn(),
      removeFavorite: jest.fn(),
      clearFavorites: jest.fn(),
      syncFavorites: jest.fn(),
      isFavorite: jest.fn(),
    } as unknown as jest.Mocked<FavoritesService>

    controller = new FavoritesController(favoritesService)
  })

  describe('GET /favorites', () => {
    it('returns web formatted apartment list by default', async () => {
      const mockApartment = {
        _id: new ObjectId(aptId),
        title: 'Căn hộ River Gate',
        category: 'Căn hộ chung cư',
        description: 'Mô tả',
        location: 'Quận 4',
        city: 'Hồ Chí Minh',
        district: 'Quận 4',
        ward: 'Phường 1',
        street: 'Bến Vân Đồn',
        address: '151 Bến Vân Đồn',
        priceMonthly: 12_000_000,
        area: 60,
        bedrooms: 2,
        bathrooms: 2,
        direction: 'Đông',
        balconyDirection: 'Nam',
        furniture: 'Đầy đủ',
        moveInTime: 'Ngay lập tức',
        electricity: 'Giá nhà nước',
        water: 'Giá nhà nước',
        internet: 'Miễn phí',
        images: ['https://example.com/img1.jpg'],
        gallery: ['https://example.com/img1.jpg'],
        images360: [],
        vrUrl: '',
        amenities: ['Hồ bơi'],
        status: 'available',
        isVerified: true,
        pricingMode: 'legacy',
        rentalPackages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Apartment

      favoritesService.getFavorites.mockResolvedValue([mockApartment])

      const result = await controller.getFavorites(userId)

      expect(favoritesService.getFavorites).toHaveBeenCalledWith(
        userId,
        undefined
      )
      expect(result).toHaveLength(1)
      expect(result[0]).toHaveProperty('id', aptId)
      expect(result[0]).toHaveProperty('title', 'Căn hộ River Gate')
    })

    it('returns mobile formatted apartment list when format=mobile', async () => {
      const mockApartment = {
        _id: new ObjectId(aptId),
        title: 'Căn hộ Sunrise City',
        category: 'Căn hộ',
        description: 'Mô tả',
        location: 'Quận 7',
        city: 'Hồ Chí Minh',
        district: 'Quận 7',
        ward: 'Tân Hưng',
        street: 'Nguyễn Hữu Thọ',
        address: 'Sunrise City',
        priceMonthly: 18_000_000,
        area: 80,
        bedrooms: 2,
        bathrooms: 2,
        direction: 'Đông',
        balconyDirection: 'Nam',
        furniture: 'Đầy đủ',
        moveInTime: 'Ngay',
        electricity: 'Giá dân',
        water: 'Giá dân',
        internet: 'Có',
        images: ['https://example.com/img1.jpg'],
        gallery: ['https://example.com/img1.jpg'],
        images360: [],
        vrUrl: '',
        amenities: [],
        status: 'available',
        isVerified: true,
        pricingMode: 'legacy',
        rentalPackages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Apartment

      favoritesService.getFavorites.mockResolvedValue([mockApartment])

      const result = await controller.getFavorites(
        userId,
        { page: 1, limit: 10 },
        'mobile'
      )

      expect(favoritesService.getFavorites).toHaveBeenCalledWith(userId, {
        page: 1,
        limit: 10,
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toHaveProperty('id', aptId)
      expect(result[0]).toHaveProperty('title', 'Căn hộ Sunrise City')
    })
  })

  describe('POST /favorites/sync', () => {
    it('calls favoritesService.syncFavorites with userId and apartmentIds', async () => {
      favoritesService.syncFavorites.mockResolvedValue({
        syncedCount: 2,
        favorites: ['apt-1', 'apt-2'],
      })

      const result = await controller.syncFavorites(userId, {
        apartmentIds: ['apt-1', 'apt-2'],
      })

      expect(favoritesService.syncFavorites).toHaveBeenCalledWith(userId, [
        'apt-1',
        'apt-2',
      ])
      expect(result).toEqual({
        syncedCount: 2,
        favorites: ['apt-1', 'apt-2'],
      })
    })
  })

  describe('POST /favorites/:apartmentId', () => {
    it('calls favoritesService.addFavorite with userId and apartmentId', async () => {
      favoritesService.addFavorite.mockResolvedValue({ isFavorite: true })

      const result = await controller.addFavorite(userId, aptId)

      expect(favoritesService.addFavorite).toHaveBeenCalledWith(userId, aptId)
      expect(result).toEqual({ isFavorite: true })
    })
  })

  describe('DELETE /favorites/:apartmentId', () => {
    it('calls favoritesService.removeFavorite with userId and apartmentId', async () => {
      favoritesService.removeFavorite.mockResolvedValue({ success: true })

      const result = await controller.removeFavorite(userId, aptId)

      expect(favoritesService.removeFavorite).toHaveBeenCalledWith(
        userId,
        aptId
      )
      expect(result).toEqual({ success: true })
    })
  })

  describe('DELETE /favorites', () => {
    it('calls favoritesService.clearFavorites with userId', async () => {
      favoritesService.clearFavorites.mockResolvedValue({ count: 5 })

      const result = await controller.clearFavorites(userId)

      expect(favoritesService.clearFavorites).toHaveBeenCalledWith(userId)
      expect(result).toEqual({ count: 5 })
    })
  })
})
