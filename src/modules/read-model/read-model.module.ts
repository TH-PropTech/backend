import { Global, Module } from '@nestjs/common'
import { ApartmentCacheInvalidator } from './services/apartment-cache-invalidator.service'
import { ApartmentChangeNotifier } from './services/apartment-change-notifier.service'

// @Global để contracts, properties... gọi notifier mà không phải import lẫn nhau (tránh vòng phụ thuộc).
@Global()
@Module({
  providers: [ApartmentChangeNotifier, ApartmentCacheInvalidator],
  exports: [ApartmentChangeNotifier],
})
export class ReadModelModule {}
