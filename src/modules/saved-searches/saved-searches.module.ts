import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { SavedSearch } from './schemas/saved-search.schema'
import { SearchAlert } from './schemas/search-alert.schema'
import { SavedSearchesService } from './saved-searches.service'
import { SavedSearchesController } from './saved-searches.controller'

@Module({
  imports: [TypeOrmModule.forFeature([SavedSearch, SearchAlert])],
  providers: [SavedSearchesService],
  controllers: [SavedSearchesController],
  exports: [SavedSearchesService],
})
export class SavedSearchesModule {}
