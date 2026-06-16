import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { CommunityPost } from './schemas/community-post.schema'
import { CommunityComment } from './schemas/community-comment.schema'

@Module({
  imports: [TypeOrmModule.forFeature([CommunityPost, CommunityComment])],
  exports: [TypeOrmModule],
})
export class CommunityModule {}
