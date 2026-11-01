import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { FavoriteApartment } from '../schemas/favorite-apartment.schema'
import { Apartment } from '../schemas/apartment.schema'
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto'

export interface SyncFavoritesResult {
  syncedCount: number
  favorites: string[]
}

@Injectable()
export class FavoritesService {
  private readonly logger = new Logger(FavoritesService.name)

  constructor(
    @InjectRepository(FavoriteApartment)
    private readonly favoriteRepository: Repository<FavoriteApartment>,
    @InjectRepository(Apartment)
    private readonly apartmentRepository: Repository<Apartment>
  ) {}

  /**
   * Lấy danh sách căn hộ yêu thích của người dùng, được nạp dữ liệu đầy đủ từ Apartment
   * để phản ánh giá cả và trạng thái còn phòng theo thời gian thực.
   * Tự động lọc bỏ và dọn dẹp các bản ghi tham chiếu đến căn hộ đã bị xóa.
   */
  async getFavorites(
    userId: string,
    query?: PaginationQueryDto
  ): Promise<Apartment[]> {
    const favorites = await this.favoriteRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    })

    if (!favorites || favorites.length === 0) {
      return []
    }

    favorites.sort((a, b) => {
      const timeA = a.createdAt instanceof Date ? a.createdAt.getTime() : 0
      const timeB = b.createdAt instanceof Date ? b.createdAt.getTime() : 0
      return timeB - timeA
    })

    const validObjectIds: ObjectId[] = []
    const stringIds: string[] = []

    for (const fav of favorites) {
      if (ObjectId.isValid(fav.apartmentId)) {
        try {
          validObjectIds.push(new ObjectId(fav.apartmentId))
        } catch {
          stringIds.push(fav.apartmentId)
        }
      } else {
        stringIds.push(fav.apartmentId)
      }
    }

    let apartments: Apartment[] = []
    if (validObjectIds.length > 0 || stringIds.length > 0) {
      const orConditions: Record<string, unknown>[] = []
      if (validObjectIds.length > 0) {
        orConditions.push({ _id: { $in: validObjectIds } })
      }
      if (stringIds.length > 0) {
        orConditions.push({ _id: { $in: stringIds } })
      }

      apartments = await this.apartmentRepository.find({
        /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- Mongo $or filter is not expressible as FindOptionsWhere */
        where: (orConditions.length === 1
          ? orConditions[0]
          : { $or: orConditions }) as any,
        /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
      })
    }

    const aptMap = new Map<string, Apartment>()
    for (const apt of apartments) {
      const idStr = apt._id?.toString?.() ?? String(apt._id)
      aptMap.set(idStr, apt)
    }

    const populated: Apartment[] = []
    const staleFavorites: FavoriteApartment[] = []

    for (const fav of favorites) {
      const apt = aptMap.get(fav.apartmentId)
      if (apt) {
        populated.push(apt)
      } else {
        staleFavorites.push(fav)
      }
    }

    if (staleFavorites.length > 0) {
      try {
        await this.favoriteRepository.remove(staleFavorites)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.warn(`Lỗi khi dọn dẹp căn hộ yêu thích đã xóa: ${message}`)
      }
    }

    if (query && (query.page !== undefined || query.limit !== undefined)) {
      const page = Math.max(1, Number(query.page) || 1)
      const limit = Math.max(1, Math.min(100, Number(query.limit) || 20))
      const startIndex = (page - 1) * limit
      return populated.slice(startIndex, startIndex + limit)
    }

    return populated
  }

  /**
   * Thêm căn hộ vào danh sách yêu thích một cách idempotent.
   */
  async addFavorite(
    userId: string,
    apartmentId: string
  ): Promise<{ isFavorite: true }> {
    const existing = await this.favoriteRepository.findOne({
      where: { userId, apartmentId },
    })

    if (!existing) {
      try {
        const favorite = this.favoriteRepository.create({
          userId,
          apartmentId,
        })
        await this.favoriteRepository.save(favorite)
      } catch (error: unknown) {
        const err = error as { code?: number; message?: string }
        if (err?.code !== 11000 && !err?.message?.includes?.('11000')) {
          throw error
        }
      }
    }

    return { isFavorite: true }
  }

  /**
   * Xóa căn hộ khỏi danh sách yêu thích của người dùng.
   */
  async removeFavorite(
    userId: string,
    apartmentId: string
  ): Promise<{ success: boolean }> {
    const existing = await this.favoriteRepository.findOne({
      where: { userId, apartmentId },
    })

    if (existing) {
      await this.favoriteRepository.remove(existing)
    }

    return { success: true }
  }

  /**
   * Xóa toàn bộ danh sách căn hộ yêu thích của người dùng.
   */
  async clearFavorites(userId: string): Promise<{ count: number }> {
    const favorites = await this.favoriteRepository.find({
      where: { userId },
    })

    const count = favorites.length
    if (count > 0) {
      await this.favoriteRepository.remove(favorites)
    }

    return { count }
  }

  /**
   * Hợp nhất danh sách apartmentId của khách vào tài khoản người dùng sau khi đăng nhập.
   */
  async syncFavorites(
    userId: string,
    apartmentIds: string[]
  ): Promise<SyncFavoritesResult> {
    const existing = await this.favoriteRepository.find({
      where: { userId },
    })
    const existingIds = new Set(existing.map(f => f.apartmentId))

    if (
      !apartmentIds ||
      !Array.isArray(apartmentIds) ||
      apartmentIds.length === 0
    ) {
      return {
        syncedCount: 0,
        favorites: Array.from(existingIds),
      }
    }

    const uniqueIncoming = Array.from(new Set(apartmentIds.filter(Boolean)))
    const toAdd = uniqueIncoming.filter(id => !existingIds.has(id))

    if (toAdd.length > 0) {
      const newFavorites = toAdd.map(apartmentId =>
        this.favoriteRepository.create({
          userId,
          apartmentId,
        })
      )
      await this.favoriteRepository.save(newFavorites)
    }

    const allFavorites = Array.from(new Set([...existingIds, ...toAdd]))
    return {
      syncedCount: toAdd.length,
      favorites: allFavorites,
    }
  }

  /**
   * Kiểm tra căn hộ đã được người dùng yêu thích hay chưa.
   */
  async isFavorite(userId: string, apartmentId: string): Promise<boolean> {
    const existing = await this.favoriteRepository.findOne({
      where: { userId, apartmentId },
    })
    return Boolean(existing)
  }
}
