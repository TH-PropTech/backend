import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { CommunityPost } from './schemas/community-post.schema'

@Module({
  imports: [TypeOrmModule.forFeature([CommunityPost])],
  exports: [TypeOrmModule],
})
export class CommunityModule {}
