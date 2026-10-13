import { NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { CommunityService } from './community.service'
import type { CommunityComment } from '../schemas/community-comment.schema'
import type { CommunityPost } from '../schemas/community-post.schema'

describe('CommunityService moderation', () => {
  type RepositoryMocks = {
    findOne: jest.Mock
    save: jest.Mock
    delete: jest.Mock
  }
  type NotificationRepositoryMocks = {
    create: jest.Mock
    save: jest.Mock
  }
  const postId = '507f1f77bcf86cd799439011'
  const commentId = '507f1f77bcf86cd799439012'

  const createService = (): {
    service: CommunityService
    postRepository: RepositoryMocks
    commentRepository: RepositoryMocks
    notificationRepository: NotificationRepositoryMocks
  } => {
    const postRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    }
    const commentRepository = {
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn(),
    }
    const notificationRepository = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn().mockResolvedValue(undefined),
    }

    return {
      service: new CommunityService(
        postRepository as never,
        commentRepository as never,
        notificationRepository as never
      ),
      postRepository,
      commentRepository,
      notificationRepository,
    }
  }

  const post = (): CommunityPost =>
    ({
      _id: new ObjectId(postId),
      authorId: 'author-1',
      title: 'Bài viết cần kiểm duyệt',
      commentsCount: 2,
    }) as CommunityPost

  it('deletes a post, its comments, and notifies the author', async () => {
    const {
      service,
      postRepository,
      commentRepository,
      notificationRepository,
    } = createService()
    postRepository.findOne.mockResolvedValue(post())

    await service.deletePost(postId)

    expect(notificationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'author-1',
        title: 'Bài viết của bạn đã bị gỡ',
        type: 'COMMUNITY',
        data: { postId },
      })
    )
    expect(notificationRepository.save).toHaveBeenCalled()
    expect(commentRepository.delete).toHaveBeenCalledWith({ postId })
    expect(postRepository.delete).toHaveBeenCalledWith({
      _id: new ObjectId(postId),
    })
  })

  it('continues deleting a post when notification persistence fails', async () => {
    const { service, postRepository, notificationRepository } = createService()
    postRepository.findOne.mockResolvedValue(post())
    notificationRepository.save.mockRejectedValue(
      new Error('notification down')
    )

    await expect(service.deletePost(postId)).resolves.toBeUndefined()
    expect(postRepository.delete).toHaveBeenCalled()
  })

  it('deletes a comment and decrements the parent post count without going below zero', async () => {
    const { service, postRepository, commentRepository } = createService()
    const comment = {
      _id: new ObjectId(commentId),
      postId,
      parentId: null,
    } as CommunityComment
    commentRepository.findOne.mockResolvedValue(comment)
    postRepository.findOne.mockResolvedValue({ ...post(), commentsCount: 1 })

    await service.deleteComment(commentId)

    expect(commentRepository.delete).toHaveBeenNthCalledWith(1, {
      _id: new ObjectId(commentId),
    })
    expect(commentRepository.delete).toHaveBeenNthCalledWith(2, {
      parentId: commentId,
    })
    expect(postRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ commentsCount: 0 })
    )
  })

  it('rejects deletion of an unknown comment', async () => {
    const { service, commentRepository } = createService()
    commentRepository.findOne.mockResolvedValue(null)

    await expect(service.deleteComment(commentId)).rejects.toBeInstanceOf(
      NotFoundException
    )
  })
})
