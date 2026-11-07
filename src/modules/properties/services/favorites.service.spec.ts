/* eslint-disable @typescript-eslint/unbound-method -- jest mock assertions */
import { ForbiddenException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { FavoritesService } from './favorites.service'
import { FavoriteApartment } from '../schemas/favorite-apartment.schema'
import { Apartment } from '../schemas/apartment.schema'

describe('FavoritesService', () => {
  let service: FavoritesService
  let favoriteRepository: jest.Mocked<Repository<FavoriteApartment>>
  let apartmentRepository: jest.Mocked<Repository<Apartment>>

  beforeEach(() => {
    favoriteRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(data => data as FavoriteApartment),
      save: jest.fn(data => Promise.resolve(data)),
      remove: jest.fn(data => Promise.resolve(data)),
    } as unknown as jest.Mocked<Repository<FavoriteApartment>>

    apartmentRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<Apartment>>

    service = new FavoritesService(favoriteRepository, apartmentRepository)
  })

  describe('getFavorites', () => {
    const userId = 'user-123'
    const aptId1 = new ObjectId().toHexString()
    const aptId2 = new ObjectId().toHexString()
    const staleAptId = new ObjectId().toHexString()

    it('returns empty array when user has no favorites', async () => {
      favoriteRepository.find.mockResolvedValue([])

      const result = await service.getFavorites(userId)

      expect(result).toEqual([])
      expect(favoriteRepository.find).toHaveBeenCalledWith({
        where: { userId },
        order: { createdAt: 'DESC' },
      })
      expect(apartmentRepository.find).not.toHaveBeenCalled()
    })

    it('populates live apartments and prunes stale deleted records', async () => {
      const fav1: FavoriteApartment = {
        _id: new ObjectId(),
        userId,
        apartmentId: aptId1,
        createdAt: new Date('2026-01-02'),
        updatedAt: new Date('2026-01-02'),
      }
      const favStale: FavoriteApartment = {
        _id: new ObjectId(),
        userId,
        apartmentId: staleAptId,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      }

      favoriteRepository.find.mockResolvedValue([fav1, favStale])

      const apt1 = {
        _id: new ObjectId(aptId1),
        title: 'Căn hộ Landmark 81',
        priceMonthly: 15_000_000,
        status: 'available',
      } as unknown as Apartment

      // apartmentRepository returns apt1 only, staleAptId is deleted/not found
      apartmentRepository.find.mockResolvedValue([apt1])

      const result = await service.getFavorites(userId)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(apt1)
      expect(favoriteRepository.remove).toHaveBeenCalledWith([favStale])
    })

    it('supports pagination with page and limit', async () => {
      const aptA = { _id: new ObjectId(aptId1), title: 'Apt A' } as Apartment
      const aptB = { _id: new ObjectId(aptId2), title: 'Apt B' } as Apartment

      const fav1: FavoriteApartment = {
        _id: new ObjectId(),
        userId,
        apartmentId: aptId1,
        createdAt: new Date('2026-01-02'),
        updatedAt: new Date('2026-01-02'),
      }
      const fav2: FavoriteApartment = {
        _id: new ObjectId(),
        userId,
        apartmentId: aptId2,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      }

      favoriteRepository.find.mockResolvedValue([fav1, fav2])
      apartmentRepository.find.mockResolvedValue([aptA, aptB])

      const page1 = await service.getFavorites(userId, { page: 1, limit: 1 })
      expect(page1).toHaveLength(1)
      expect(page1[0]).toEqual(aptA)

      const page2 = await service.getFavorites(userId, { page: 2, limit: 1 })
      expect(page2).toHaveLength(1)
      expect(page2[0]).toEqual(aptB)
    })
  })

  describe('addFavorite', () => {
    const userId = 'user-123'
    const apartmentId = new ObjectId().toHexString()

    it('rejects when the user is the landlord of the apartment', async () => {
      apartmentRepository.find.mockResolvedValue([
        { _id: new ObjectId(apartmentId), landlordId: userId } as Apartment,
      ])

      await expect(service.addFavorite(userId, apartmentId)).rejects.toThrow(
        ForbiddenException
      )
      expect(favoriteRepository.save).not.toHaveBeenCalled()
    })

    it('adds favorite idempotently if not already saved', async () => {
      favoriteRepository.findOne.mockResolvedValue(null)

      const result = await service.addFavorite(userId, apartmentId)

      expect(result).toEqual({ isFavorite: true })
      expect(favoriteRepository.create).toHaveBeenCalledWith({
        userId,
        apartmentId,
      })
      expect(favoriteRepository.save).toHaveBeenCalled()
    })

    it('does not save duplicate if already exists', async () => {
      const existing: FavoriteApartment = {
        _id: new ObjectId(),
        userId,
        apartmentId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      favoriteRepository.findOne.mockResolvedValue(existing)

      const result = await service.addFavorite(userId, apartmentId)

      expect(result).toEqual({ isFavorite: true })
      expect(favoriteRepository.create).not.toHaveBeenCalled()
      expect(favoriteRepository.save).not.toHaveBeenCalled()
    })

    it('handles duplicate key error gracefully', async () => {
      favoriteRepository.findOne.mockResolvedValue(null)
      const duplicateError = new Error(
        'E11000 duplicate key error'
      ) as Error & {
        code?: number
      }
      duplicateError.code = 11000
      favoriteRepository.save.mockRejectedValue(duplicateError)

      const result = await service.addFavorite(userId, apartmentId)

      expect(result).toEqual({ isFavorite: true })
    })
  })

  describe('removeFavorite', () => {
    const userId = 'user-123'
    const apartmentId = new ObjectId().toHexString()

    it('deletes favorite when found', async () => {
      const existing: FavoriteApartment = {
        _id: new ObjectId(),
        userId,
        apartmentId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      favoriteRepository.findOne.mockResolvedValue(existing)

      const result = await service.removeFavorite(userId, apartmentId)

      expect(result).toEqual({ success: true })
      expect(favoriteRepository.remove).toHaveBeenCalledWith(existing)
    })

    it('returns success: true even when favorite not found', async () => {
      favoriteRepository.findOne.mockResolvedValue(null)

      const result = await service.removeFavorite(userId, apartmentId)

      expect(result).toEqual({ success: true })
      expect(favoriteRepository.remove).not.toHaveBeenCalled()
    })
  })

  describe('clearFavorites', () => {
    const userId = 'user-123'

    it('deletes all favorites for user and returns count', async () => {
      const favs: FavoriteApartment[] = [
        {
          _id: new ObjectId(),
          userId,
          apartmentId: 'apt-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          _id: new ObjectId(),
          userId,
          apartmentId: 'apt-2',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]
      favoriteRepository.find.mockResolvedValue(favs)

      const result = await service.clearFavorites(userId)

      expect(result).toEqual({ count: 2 })
      expect(favoriteRepository.remove).toHaveBeenCalledWith(favs)
    })

    it('returns 0 count when user has no favorites', async () => {
      favoriteRepository.find.mockResolvedValue([])

      const result = await service.clearFavorites(userId)

      expect(result).toEqual({ count: 0 })
      expect(favoriteRepository.remove).not.toHaveBeenCalled()
    })
  })

  describe('syncFavorites', () => {
    const userId = 'user-123'

    it('skips apartments owned by the user', async () => {
      const ownId = new ObjectId()
      favoriteRepository.find.mockResolvedValue([])
      apartmentRepository.find.mockResolvedValue([
        { _id: ownId, landlordId: userId } as Apartment,
      ])

      const result = await service.syncFavorites(userId, [
        ownId.toHexString(),
        'apt-other',
      ])

      expect(result.syncedCount).toBe(1)
      expect(result.favorites).toEqual(['apt-other'])
    })

    it('merges guest apartmentIds into user favorites idempotently', async () => {
      const existing: FavoriteApartment[] = [
        {
          _id: new ObjectId(),
          userId,
          apartmentId: 'apt-existing',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]
      favoriteRepository.find.mockResolvedValue(existing)

      const result = await service.syncFavorites(userId, [
        'apt-existing',
        'apt-new-1',
        'apt-new-2',
        'apt-new-1', // duplicate in input
      ])

      expect(result.syncedCount).toBe(2)
      expect(result.favorites).toEqual(
        expect.arrayContaining(['apt-existing', 'apt-new-1', 'apt-new-2'])
      )
      expect(favoriteRepository.save).toHaveBeenCalled()
    })

    it('handles empty input gracefully', async () => {
      favoriteRepository.find.mockResolvedValue([])

      const result = await service.syncFavorites(userId, [])

      expect(result).toEqual({ syncedCount: 0, favorites: [] })
      expect(favoriteRepository.save).not.toHaveBeenCalled()
    })
  })

  describe('isFavorite', () => {
    const userId = 'user-123'
    const apartmentId = 'apt-1'

    it('returns true when favorite exists', async () => {
      favoriteRepository.findOne.mockResolvedValue({
        _id: new ObjectId(),
        userId,
        apartmentId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await service.isFavorite(userId, apartmentId)
      expect(result).toBe(true)
    })

    it('returns false when favorite does not exist', async () => {
      favoriteRepository.findOne.mockResolvedValue(null)

      const result = await service.isFavorite(userId, apartmentId)
      expect(result).toBe(false)
    })
  })
})
