import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { CommunityPost } from './schemas/community-post.schema'
import { CommunityComment } from './schemas/community-comment.schema'
import { CommunityService } from './community.service'
import { CommunityController } from './community.controller'

@Module({
  imports: [TypeOrmModule.forFeature([CommunityPost, CommunityComment])],
  providers: [CommunityService],
  controllers: [CommunityController],
  exports: [TypeOrmModule, CommunityService],
})
export class CommunityModule {}
