import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { CommunityService } from './community.service'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CreatePostDto } from './dto/create-post.dto'
import { UpdatePostStatusDto } from './dto/update-post-status.dto'
import { CreateCommentDto } from './dto/create-comment.dto'
import { UserPayload } from '../auth/interfaces/auth.interface'
import { CommunityPost } from './schemas/community-post.schema'
import { CommunityComment } from './schemas/community-comment.schema'

@ApiTags('community')
@Controller('community')
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @Get('posts')
  async getPosts(
    @Query('topic') topic?: 'qa' | 'review' | 'roommate',
    @Query('search') search?: string
  ): Promise<CommunityPost[]> {
    return this.communityService.findAllApproved(topic, search)
  }

  @Get('posts/my')
  @UseGuards(JwtAuthGuard)
  async getMyPosts(
    @Request() req: { user: UserPayload }
  ): Promise<CommunityPost[]> {
    const userId = req.user._id
    if (!userId) throw new Error('Không thể xác thực người dùng')
    return this.communityService.findMyPosts(userId)
  }

  @Get('posts/pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff')
  async getPendingPosts(): Promise<CommunityPost[]> {
    return this.communityService.findPending()
  }

  @Get('posts/:id')
  async getPost(@Param('id') id: string): Promise<CommunityPost> {
    return this.communityService.findOne(id)
  }

  @Post('posts')
  @UseGuards(JwtAuthGuard)
  async createPost(
    @Request() req: { user: UserPayload },
    @Body() dto: CreatePostDto
  ): Promise<CommunityPost> {
    const userId = req.user._id
    const userName = req.user.name || 'Người dùng TH PropTech'
    const userRole = (req.user.roles && req.user.roles[0]) || 'tenant'

    if (!userId) throw new Error('Không thể xác thực người dùng')

    return this.communityService.createPost(
      userId,
      userName,
      userRole as 'tenant' | 'landlord' | 'staff' | 'admin',
      dto
    )
  }

  @Patch('posts/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff')
  async updatePostStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePostStatusDto
  ): Promise<CommunityPost> {
    return this.communityService.updateStatus(id, dto.status)
  }

  @Patch('posts/:id/upvote')
  @UseGuards(JwtAuthGuard)
  async upvotePost(
    @Param('id') id: string,
    @Request() req: { user: UserPayload }
  ): Promise<CommunityPost> {
    const userId = req.user._id
    if (!userId) throw new Error('Không thể xác thực người dùng')
    return this.communityService.upvote(id, userId)
  }

  @Get('posts/:id/comments')
  async getComments(@Param('id') id: string): Promise<CommunityComment[]> {
    return this.communityService.getComments(id)
  }

  @Post('posts/:id/comments')
  @UseGuards(JwtAuthGuard)
  async addComment(
    @Param('id') id: string,
    @Request() req: { user: UserPayload },
    @Body() dto: CreateCommentDto
  ): Promise<CommunityComment> {
    const userId = req.user._id
    const userName = req.user.name || 'Người dùng TH PropTech'
    const userRole = (req.user.roles && req.user.roles[0]) || 'tenant'

    if (!userId) throw new Error('Không thể xác thực người dùng')

    return this.communityService.addComment(
      id,
      userId,
      userName,
      userRole as 'tenant' | 'landlord' | 'staff' | 'admin',
      dto
    )
  }

  @Delete('posts/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  async deletePost(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.communityService.deletePost(id)
    return { success: true }
  }

  @Delete('comments/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  async deleteComment(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.communityService.deleteComment(id)
    return { success: true }
  }
}
