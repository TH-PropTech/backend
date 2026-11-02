import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ReadCacheService } from '../../health/services/read-cache.service'
import { ApartmentChangeNotifier } from './apartment-change-notifier.service'

export const APARTMENT_CACHE_NAMESPACE = 'apartments'

/** Phía đọc: mỗi thay đổi căn hộ tăng version cache, khoá cũ không còn được dùng. */
@Injectable()
export class ApartmentCacheInvalidator
  implements OnModuleInit, OnModuleDestroy
{
  private unsubscribe?: () => void

  constructor(
    private readonly notifier: ApartmentChangeNotifier,
    private readonly readCache: ReadCacheService
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.notifier.subscribe(() =>
      this.readCache.invalidate(APARTMENT_CACHE_NAMESPACE)
    )
  }

  onModuleDestroy(): void {
    this.unsubscribe?.()
  }
}
