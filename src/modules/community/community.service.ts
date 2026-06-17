import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, FindOptionsWhere } from 'typeorm'
import { ObjectId } from 'mongodb'
import { CommunityPost } from './schemas/community-post.schema'
import { CommunityComment } from './schemas/community-comment.schema'
import { CreatePostDto } from './dto/create-post.dto'
import { CreateCommentDto } from './dto/create-comment.dto'

@Injectable()
export class CommunityService {
  private readonly logger = new Logger(CommunityService.name)

  constructor(
    @InjectRepository(CommunityPost)
    private readonly postRepository: Repository<CommunityPost>,
    @InjectRepository(CommunityComment)
    private readonly commentRepository: Repository<CommunityComment>
  ) {}

  async createPost(
    authorId: string,
    authorName: string,
    authorRole: 'tenant' | 'landlord' | 'staff' | 'admin',
    dto: CreatePostDto
  ): Promise<CommunityPost> {
    this.logger.log(`Creating community post by user: ${authorId}`)
    const post = new CommunityPost()
    post.authorId = authorId
    post.authorName = authorName
    post.authorRole = authorRole
    post.title = dto.title
    post.content = dto.content
    post.projectName = dto.projectName
    post.topic = dto.topic
    post.images = dto.images || []
    post.tags = dto.tags || []
    post.upvotes = []
    post.commentsCount = 0
    post.status = 'pending'

    return this.postRepository.save(post)
  }

  async findAllApproved(
    topic?: 'qa' | 'review' | 'roommate',
    search?: string
  ): Promise<CommunityPost[]> {
    this.logger.log(
      `Fetching approved community posts. Topic: ${topic}, search: ${search}`
    )
    const query: Record<string, unknown> = { status: 'approved' }

    if (topic) {
      query.topic = topic
    }

    if (search) {
      query.projectName = { $regex: search, $options: 'i' }
    }

    return this.postRepository.find({
      where: query as FindOptionsWhere<CommunityPost>,
      order: { createdAt: 'DESC' },
    })
  }

  async findPending(): Promise<CommunityPost[]> {
    this.logger.log('Fetching pending community posts for moderation')
    return this.postRepository.find({
      where: { status: 'pending' },
      order: { createdAt: 'DESC' },
    })
  }

  async findMyPosts(authorId: string): Promise<CommunityPost[]> {
    this.logger.log(`Fetching posts for author: ${authorId}`)
    return this.postRepository.find({
      where: { authorId },
      order: { createdAt: 'DESC' },
    })
  }

  async findOne(id: string): Promise<CommunityPost> {
    try {
      const post = await this.postRepository.findOne({
        where: { _id: new ObjectId(id) },
      })
      if (!post) {
        throw new NotFoundException(`Không tìm thấy bài viết với ID: ${id}`)
      }
      return post
    } catch {
      throw new NotFoundException(`ID bài viết không hợp lệ: ${id}`)
    }
  }

  async updateStatus(
    id: string,
    status: 'approved' | 'rejected'
  ): Promise<CommunityPost> {
    this.logger.log(`Updating status of post ${id} to ${status}`)
    const post = await this.findOne(id)
    post.status = status
    return this.postRepository.save(post)
  }

  async upvote(id: string, userId: string): Promise<CommunityPost> {
    this.logger.log(`User ${userId} toggling upvote on post ${id}`)
    const post = await this.findOne(id)

    if (!post.upvotes) {
      post.upvotes = []
    }

    const index = post.upvotes.indexOf(userId)
    if (index > -1) {
      post.upvotes.splice(index, 1)
    } else {
      post.upvotes.push(userId)
    }

    return this.postRepository.save(post)
  }

  async getComments(postId: string): Promise<CommunityComment[]> {
    this.logger.log(`Fetching comments for post: ${postId}`)
    return this.commentRepository.find({
      where: { postId },
      order: { createdAt: 'ASC' },
    })
  }

  async addComment(
    postId: string,
    authorId: string,
    authorName: string,
    authorRole: 'tenant' | 'landlord' | 'staff' | 'admin',
    dto: CreateCommentDto
  ): Promise<CommunityComment> {
    this.logger.log(`Adding comment to post ${postId} by user ${authorId}`)
    const post = await this.findOne(postId)

    const comment = new CommunityComment()
    comment.postId = postId
    comment.parentId = dto.parentId || null
    comment.authorId = authorId
    comment.authorName = authorName
    // Map 'admin' role to 'staff' if schema role constraint is strict, but let's check:
    comment.authorRole = authorRole === 'admin' ? 'staff' : authorRole
    comment.content = dto.content

    const savedComment = await this.commentRepository.save(comment)

    // Update post comment count
    post.commentsCount = (post.commentsCount || 0) + 1
    await this.postRepository.save(post)

    return savedComment
  }
}
