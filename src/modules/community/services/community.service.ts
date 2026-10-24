import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, FindOptionsWhere } from 'typeorm'
import { ObjectId } from 'mongodb'
import type { CommunityPost } from '../schemas/community-post.schema'
import type { CommunityComment } from '../schemas/community-comment.schema'
import {
  CommunityEntry,
  PostEntry,
  CommentEntry,
} from '../schemas/community-entry.schema'
import { Notification } from '../../notifications/schemas/notification.schema'
import { CreatePostDto } from '../dto/create-post.dto'
import { CreateCommentDto } from '../dto/create-comment.dto'

/** Bỏ `kind` khỏi phản hồi để giữ nguyên hình dạng JSON cũ. */
function toPost(entry: PostEntry): CommunityPost {
  const copy: Partial<PostEntry> = { ...entry }
  delete copy.kind
  return copy as unknown as CommunityPost
}

function toComment(entry: CommentEntry): CommunityComment {
  const copy: Partial<CommentEntry> = { ...entry }
  delete copy.kind
  return copy as unknown as CommunityComment
}

export interface ListPostsParams {
  topic?: 'qa' | 'review' | 'roommate' | undefined
  search?: string | undefined
  project?: string | undefined
  page?: number | undefined
  limit?: number | undefined
}

export interface CommunityStats {
  contributorCount: number
  projectCount: number
  projects: { name: string; posts: number }[]
}

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
const SEARCH_FIELDS = ['title', 'content', 'projectName', 'authorName']

/** Thoát ký tự đặc biệt để chuỗi người dùng nhập chỉ được khớp theo nghĩa đen. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Ảnh chỉ nhận URL https; `blob:`/`file:` chỉ có nghĩa trên máy người đăng. */
function keepHttpsImages(images: string[] | undefined): string[] {
  return (images ?? []).filter(url => /^https:\/\/\S+$/i.test(url)).slice(0, 5)
}

function toPositiveInt(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value as number) > 0
    ? (value as number)
    : fallback
}

@Injectable()
export class CommunityService {
  private readonly logger = new Logger(CommunityService.name)

  constructor(
    @InjectRepository(CommunityEntry)
    private readonly entryRepository: Repository<CommunityEntry>,
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>
  ) {}

  async createPost(
    authorId: string,
    authorName: string,
    authorRole: 'tenant' | 'landlord' | 'staff' | 'admin',
    dto: CreatePostDto
  ): Promise<CommunityPost> {
    this.logger.log(`Creating community post by user: ${authorId}`)
    const post = new CommunityEntry() as PostEntry
    post.kind = 'post'
    post.authorId = authorId
    post.authorName = authorName
    post.authorRole = authorRole
    post.title = dto.title
    post.content = dto.content
    post.projectName = dto.projectName
    post.topic = dto.topic
    post.images = keepHttpsImages(dto.images)
    post.tags = dto.tags || []
    post.upvotes = []
    post.commentsCount = 0
    post.status = 'pending'

    return toPost(await this.entryRepository.save(post))
  }

  async findAllApproved(
    params: ListPostsParams = {}
  ): Promise<CommunityPost[]> {
    const { topic, search, project } = params
    this.logger.log(
      `Fetching approved community posts. Topic: ${topic}, search: ${search}, project: ${project}`
    )
    const query: Record<string, unknown> = { kind: 'post', status: 'approved' }

    if (topic) {
      query.topic = topic
    }

    const keyword = search?.trim()
    if (keyword) {
      const pattern = { $regex: escapeRegex(keyword), $options: 'i' }
      query.$or = SEARCH_FIELDS.map(field => ({ [field]: pattern }))
    }

    const projectName = project?.trim()
    if (projectName) {
      query.projectName = {
        $regex: `^${escapeRegex(projectName)}$`,
        $options: 'i',
      }
    }

    const take = Math.min(
      toPositiveInt(params.limit, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE
    )
    const page = toPositiveInt(params.page, 1)

    const entries = await this.entryRepository.find({
      where: query as FindOptionsWhere<CommunityEntry>,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * take,
      take,
    })
    return (entries as PostEntry[]).map(toPost)
  }

  /**
   * Số liệu tổng quan trên toàn bộ bài đã duyệt (không phụ thuộc phân trang).
   * ponytail: tính trong bộ nhớ; chuyển sang aggregate khi số bài lên hàng chục nghìn.
   */
  async getStats(): Promise<CommunityStats> {
    const entries = (await this.entryRepository.find({
      where: { kind: 'post', status: 'approved' },
      select: ['authorId', 'projectName'],
    })) as PostEntry[]

    const authors = new Set<string>()
    const counts = new Map<string, number>()
    for (const entry of entries) {
      if (entry.authorId) authors.add(entry.authorId)
      if (entry.projectName) {
        counts.set(entry.projectName, (counts.get(entry.projectName) ?? 0) + 1)
      }
    }
    const projects = [...counts.entries()]
      .map(([name, posts]) => ({ name, posts }))
      .sort((a, b) => b.posts - a.posts)

    return {
      contributorCount: authors.size,
      projectCount: projects.length,
      projects,
    }
  }

  async findPending(): Promise<CommunityPost[]> {
    this.logger.log('Fetching pending community posts for moderation')
    const entries = await this.entryRepository.find({
      where: { kind: 'post', status: 'pending' },
      order: { createdAt: 'DESC' },
    })
    return (entries as PostEntry[]).map(toPost)
  }

  async findMyPosts(authorId: string): Promise<CommunityPost[]> {
    this.logger.log(`Fetching posts for author: ${authorId}`)
    const entries = await this.entryRepository.find({
      where: { kind: 'post', authorId },
      order: { createdAt: 'DESC' },
    })
    return (entries as PostEntry[]).map(toPost)
  }

  /** Endpoint công khai: bài chưa duyệt hoặc bị từ chối coi như không tồn tại. */
  async findOne(id: string): Promise<CommunityPost> {
    const post = await this.findPostEntry(id)
    if (post.status !== 'approved') {
      throw new NotFoundException(`Không tìm thấy bài viết với ID: ${id}`)
    }
    return toPost(post)
  }

  private async findApprovedPostEntry(id: string): Promise<PostEntry> {
    const post = await this.findPostEntry(id)
    if (post.status !== 'approved') {
      throw new NotFoundException(`Không tìm thấy bài viết với ID: ${id}`)
    }
    return post
  }

  /** Tra bài viết theo `_id` VÀ `kind: 'post'` (id bình luận => 404). */
  private async findPostEntry(id: string): Promise<PostEntry> {
    try {
      const post = (await this.entryRepository.findOne({
        where: { _id: new ObjectId(id), kind: 'post' },
      })) as PostEntry | null
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
    const post = await this.findPostEntry(id)
    post.status = status
    return toPost(await this.entryRepository.save(post))
  }

  async upvote(id: string, userId: string): Promise<CommunityPost> {
    this.logger.log(`User ${userId} toggling upvote on post ${id}`)
    const post = await this.findApprovedPostEntry(id)

    if (!post.upvotes) {
      post.upvotes = []
    }

    const index = post.upvotes.indexOf(userId)
    if (index > -1) {
      post.upvotes.splice(index, 1)
    } else {
      post.upvotes.push(userId)
    }

    return toPost(await this.entryRepository.save(post))
  }

  async getComments(postId: string): Promise<CommunityComment[]> {
    this.logger.log(`Fetching comments for post: ${postId}`)
    const entries = await this.entryRepository.find({
      where: { kind: 'comment', postId },
      order: { createdAt: 'ASC' },
    })
    return (entries as CommentEntry[]).map(toComment)
  }

  async addComment(
    postId: string,
    authorId: string,
    authorName: string,
    authorRole: 'tenant' | 'landlord' | 'staff' | 'admin',
    dto: CreateCommentDto
  ): Promise<CommunityComment> {
    this.logger.log(`Adding comment to post ${postId} by user ${authorId}`)
    const post = await this.findApprovedPostEntry(postId)

    const comment = new CommunityEntry() as CommentEntry
    comment.kind = 'comment'
    comment.postId = postId
    comment.parentId = dto.parentId || null
    comment.authorId = authorId
    comment.authorName = authorName
    // Map 'admin' role to 'staff' if schema role constraint is strict, but let's check:
    comment.authorRole = authorRole === 'admin' ? 'staff' : authorRole
    comment.content = dto.content

    const savedComment = await this.entryRepository.save(comment)

    // Update post comment count
    post.commentsCount = (post.commentsCount || 0) + 1
    await this.entryRepository.save(post)

    return toComment(savedComment)
  }

  /** Staff gỡ bài vi phạm: báo cho tác giả rồi xóa bài cùng bình luận. */
  async deletePost(id: string): Promise<void> {
    this.logger.log(`Deleting community post: ${id}`)
    const post = await this.findPostEntry(id)

    // Create and save bell notification for the author
    if (post.authorId) {
      try {
        const notification = this.notificationRepository.create({
          userId: post.authorId,
          title: 'Bài viết của bạn đã bị gỡ',
          body: `Bài viết "${post.title}" của bạn đã bị gỡ bỏ do vi phạm tiêu chuẩn cộng đồng.`,
          type: 'COMMUNITY',
          isRead: false,
          data: { postId: id },
        })
        await this.notificationRepository.save(notification)
      } catch (err) {
        this.logger.warn(
          `Không thể gửi thông báo gỡ bài viết tới tác giả ${post.authorId}:`,
          err
        )
      }
    }

    await this.purgePost(id)
  }

  /** Tác giả tự xóa bài của mình (không gửi thông báo vi phạm). */
  async deleteOwnPost(id: string, userId: string): Promise<void> {
    this.logger.log(`User ${userId} deleting own community post: ${id}`)
    const post = await this.findPostEntry(id)
    if (post.authorId !== userId) {
      throw new ForbiddenException('Bạn chỉ có thể xóa bài viết của chính mình')
    }
    await this.purgePost(id)
  }

  private async purgePost(id: string): Promise<void> {
    try {
      await this.entryRepository.delete({ kind: 'comment', postId: id })
    } catch (err) {
      this.logger.warn(`Không thể xóa bình luận của bài viết ${id}:`, err)
    }
    await this.entryRepository.delete({ _id: new ObjectId(id), kind: 'post' })
  }

  /** Mọi bình luận con cháu của `rootId` (duyệt theo từng tầng `parentId`). */
  private async collectDescendantIds(rootId: string): Promise<string[]> {
    const found: string[] = []
    let frontier = [rootId]
    while (frontier.length > 0) {
      const query: Record<string, unknown> = {
        kind: 'comment',
        parentId: { $in: frontier },
      }
      const level = (await this.entryRepository.find({
        where: query as FindOptionsWhere<CommunityEntry>,
      })) as CommentEntry[]
      frontier = level.map(c => String(c._id))
      found.push(...frontier)
    }
    return found
  }

  /**
   * Xóa bình luận cùng toàn bộ trả lời của nó. `ownerId` (nếu có) buộc người
   * gọi phải là tác giả; staff gọi không truyền `ownerId`.
   */
  async deleteComment(id: string, ownerId?: string): Promise<void> {
    this.logger.log(`Deleting community comment: ${id}`)
    let comment: CommentEntry | null = null
    try {
      comment = (await this.entryRepository.findOne({
        where: { _id: new ObjectId(id), kind: 'comment' },
      })) as CommentEntry | null
    } catch {
      throw new NotFoundException(`ID bình luận không hợp lệ: ${id}`)
    }

    if (!comment) {
      throw new NotFoundException(`Không tìm thấy bình luận với ID: ${id}`)
    }
    if (ownerId !== undefined && comment.authorId !== ownerId) {
      throw new ForbiddenException(
        'Bạn chỉ có thể xóa bình luận của chính mình'
      )
    }

    const descendantIds = await this.collectDescendantIds(id)

    await this.entryRepository.delete({
      _id: new ObjectId(id),
      kind: 'comment',
    })
    if (descendantIds.length > 0) {
      try {
        const query: Record<string, unknown> = {
          kind: 'comment',
          _id: { $in: descendantIds.map(d => new ObjectId(d)) },
        }
        await this.entryRepository.delete(query)
      } catch (err) {
        this.logger.warn(
          `Không thể xóa bình luận con của bình luận ${id}:`,
          err
        )
      }
    }

    // Số bình luận của bài giảm đúng bằng số bình luận đã xóa (gốc + con cháu)
    try {
      const post = await this.findPostEntry(comment.postId)
      post.commentsCount = Math.max(
        0,
        (post.commentsCount || 0) - (1 + descendantIds.length)
      )
      await this.entryRepository.save(post)
    } catch (err) {
      this.logger.warn(
        `Không thể cập nhật commentsCount của bài viết ${comment.postId}:`,
        err
      )
    }
  }
}
