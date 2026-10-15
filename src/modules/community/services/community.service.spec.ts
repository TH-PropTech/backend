import { NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { CommunityService } from './community.service'
import type {
  CommentEntry,
  CommunityEntry,
  PostEntry,
} from '../schemas/community-entry.schema'

type Mocks = {
  find: jest.Mock
  findOne: jest.Mock
  save: jest.Mock
  delete: jest.Mock
}

const postId = '507f1f77bcf86cd799439011'
const commentId = '507f1f77bcf86cd799439012'

const createService = (): {
  service: CommunityService
  entryRepository: Mocks
  notificationRepository: { create: jest.Mock; save: jest.Mock }
} => {
  const entryRepository = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  }
  const notificationRepository = {
    create: jest.fn((value: unknown) => value),
    save: jest.fn().mockResolvedValue(undefined),
  }
  return {
    service: new CommunityService(
      entryRepository as never,
      notificationRepository as never
    ),
    entryRepository,
    notificationRepository,
  }
}

const post = (extra: Partial<PostEntry> = {}): PostEntry =>
  ({
    _id: new ObjectId(postId),
    kind: 'post',
    authorId: 'author-1',
    title: 'Bài viết cần kiểm duyệt',
    commentsCount: 2,
    ...extra,
  }) as PostEntry

describe('CommunityService moderation', () => {
  it('deletes a post, its comments, and notifies the author', async () => {
    const { service, entryRepository, notificationRepository } = createService()
    entryRepository.findOne.mockResolvedValue(post())

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
    expect(entryRepository.delete).toHaveBeenCalledWith({
      kind: 'comment',
      postId,
    })
    expect(entryRepository.delete).toHaveBeenCalledWith({
      _id: new ObjectId(postId),
      kind: 'post',
    })
  })

  it('continues deleting a post when notification persistence fails', async () => {
    const { service, entryRepository, notificationRepository } = createService()
    entryRepository.findOne.mockResolvedValue(post())
    notificationRepository.save.mockRejectedValue(
      new Error('notification down')
    )

    await expect(service.deletePost(postId)).resolves.toBeUndefined()
    expect(entryRepository.delete).toHaveBeenCalledWith({
      _id: new ObjectId(postId),
      kind: 'post',
    })
  })

  it('deletes a comment and decrements the parent post count without going below zero', async () => {
    const { service, entryRepository } = createService()
    const comment = {
      _id: new ObjectId(commentId),
      kind: 'comment',
      postId,
      parentId: null,
    } as CommentEntry
    entryRepository.findOne
      .mockResolvedValueOnce(comment)
      .mockResolvedValueOnce(post({ commentsCount: 1 }))

    await service.deleteComment(commentId)

    expect(entryRepository.findOne).toHaveBeenNthCalledWith(1, {
      where: { _id: new ObjectId(commentId), kind: 'comment' },
    })
    expect(entryRepository.findOne).toHaveBeenNthCalledWith(2, {
      where: { _id: new ObjectId(postId), kind: 'post' },
    })
    expect(entryRepository.delete).toHaveBeenNthCalledWith(1, {
      _id: new ObjectId(commentId),
      kind: 'comment',
    })
    expect(entryRepository.delete).toHaveBeenNthCalledWith(2, {
      kind: 'comment',
      parentId: commentId,
    })
    expect(entryRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ commentsCount: 0 })
    )
  })

  it('rejects deletion of an unknown comment', async () => {
    const { service, entryRepository } = createService()
    entryRepository.findOne.mockResolvedValue(null)

    await expect(service.deleteComment(commentId)).rejects.toBeInstanceOf(
      NotFoundException
    )
    expect(entryRepository.delete).not.toHaveBeenCalled()
  })
})

describe('CommunityService behaviour (G-CMT, kind-scoped)', () => {
  it('createPost saves a pending kind=post entry and hides kind from the result', async () => {
    const { service, entryRepository } = createService()
    const result = await service.createPost('u1', 'U One', 'tenant', {
      title: 't',
      content: 'c',
      projectName: 'p',
      topic: 'qa',
    } as never)

    expect(entryRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'post', status: 'pending' })
    )
    expect(result).toMatchObject({
      authorId: 'u1',
      authorName: 'U One',
      authorRole: 'tenant',
      title: 't',
      status: 'pending',
      commentsCount: 0,
      upvotes: [],
      images: [],
      tags: [],
    })
    expect(result).not.toHaveProperty('kind')
  })

  it('findAllApproved filters kind, approved, topic and project regex, newest first', async () => {
    const { service, entryRepository } = createService()
    await service.findAllApproved('review', 'abc')
    expect(entryRepository.find).toHaveBeenCalledWith({
      where: {
        kind: 'post',
        status: 'approved',
        topic: 'review',
        projectName: { $regex: 'abc', $options: 'i' },
      },
      order: { createdAt: 'DESC' },
    })
  })

  it('findAllApproved without filters still scopes to posts', async () => {
    const { service, entryRepository } = createService()
    await service.findAllApproved()
    expect(entryRepository.find).toHaveBeenCalledWith({
      where: { kind: 'post', status: 'approved' },
      order: { createdAt: 'DESC' },
    })
  })

  it('findPending and findMyPosts are scoped to kind=post, newest first, without kind in results', async () => {
    const { service, entryRepository } = createService()
    entryRepository.find.mockResolvedValue([post()])
    const pending = await service.findPending()
    const mine = await service.findMyPosts('u1')
    expect(entryRepository.find).toHaveBeenNthCalledWith(1, {
      where: { kind: 'post', status: 'pending' },
      order: { createdAt: 'DESC' },
    })
    expect(entryRepository.find).toHaveBeenNthCalledWith(2, {
      where: { kind: 'post', authorId: 'u1' },
      order: { createdAt: 'DESC' },
    })
    expect(pending[0]).not.toHaveProperty('kind')
    expect(mine[0]).not.toHaveProperty('kind')
  })

  it('findOne answers 404 when no post has that id, and queries with kind=post', async () => {
    const { service, entryRepository } = createService()
    entryRepository.findOne.mockResolvedValue(null)
    await expect(service.findOne(commentId)).rejects.toBeInstanceOf(
      NotFoundException
    )
    await expect(service.findOne('bad')).rejects.toBeInstanceOf(
      NotFoundException
    )
    expect(entryRepository.findOne).toHaveBeenCalledWith({
      where: { _id: new ObjectId(commentId), kind: 'post' },
    })
  })

  it('updateStatus saves the new status', async () => {
    const { service, entryRepository } = createService()
    entryRepository.findOne.mockResolvedValue(post({ status: 'pending' }))
    const result = await service.updateStatus(postId, 'approved')
    expect(result.status).toBe('approved')
    expect(result).not.toHaveProperty('kind')
    expect(entryRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'post', status: 'approved' })
    )
  })

  it('upvote toggles the user in the upvotes array', async () => {
    const { service, entryRepository } = createService()
    entryRepository.findOne.mockResolvedValue(post({ upvotes: [] }))
    const added = await service.upvote(postId, 'u1')
    expect(added.upvotes).toEqual(['u1'])
    const removed = await service.upvote(postId, 'u1')
    expect(removed.upvotes).toEqual([])
  })

  it('getComments lists the comments of one post oldest first, scoped to kind=comment', async () => {
    const { service, entryRepository } = createService()
    entryRepository.find.mockResolvedValue([
      { _id: new ObjectId(commentId), kind: 'comment', postId },
    ])
    const result = await service.getComments(postId)
    expect(entryRepository.find).toHaveBeenCalledWith({
      where: { kind: 'comment', postId },
      order: { createdAt: 'ASC' },
    })
    expect(result[0]).not.toHaveProperty('kind')
  })

  it('addComment saves a kind=comment entry (admin becomes staff) and increments commentsCount', async () => {
    const { service, entryRepository } = createService()
    entryRepository.findOne.mockResolvedValue(post({ commentsCount: 2 }))
    const result = await service.addComment(postId, 'u1', 'U', 'admin', {
      content: 'hi',
      parentId: commentId,
    })
    expect(result).toMatchObject({
      postId,
      parentId: commentId,
      authorRole: 'staff',
      content: 'hi',
    })
    expect(result).not.toHaveProperty('kind')
    expect(entryRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'comment', postId })
    )
    expect(entryRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'post', commentsCount: 3 })
    )
  })

  describe('isolation between posts and comments in the shared collection', () => {
    function fakeStore(rows: CommunityEntry[]): {
      find: jest.Mock
      findOne: jest.Mock
    } {
      const matches = (
        row: CommunityEntry,
        where: Record<string, unknown>
      ): boolean =>
        Object.entries(where).every(([k, v]) =>
          v instanceof ObjectId
            ? String((row as unknown as Record<string, unknown>)[k]) ===
              String(v)
            : (row as unknown as Record<string, unknown>)[k] === v
        )
      return {
        find: jest.fn(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(rows.filter(r => matches(r, where)))
        ),
        findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(rows.find(r => matches(r, where)) ?? null)
        ),
      }
    }

    const rows = (): CommunityEntry[] => [
      post({ authorId: 'u1' }),
      {
        _id: new ObjectId(commentId),
        kind: 'comment',
        postId,
        authorId: 'u1',
      } as CommentEntry,
    ]

    it('findMyPosts does not return comments of the same author', async () => {
      const { service } = createService()
      const store = fakeStore(rows())
      Object.assign(
        (service as unknown as { entryRepository: object }).entryRepository,
        store
      )

      const mine = await service.findMyPosts('u1')

      expect(mine).toHaveLength(1)
      expect(mine[0]?._id).toEqual(new ObjectId(postId))
    })

    it('findOne with a comment id answers 404 instead of returning the comment', async () => {
      const { service } = createService()
      Object.assign(
        (service as unknown as { entryRepository: object }).entryRepository,
        fakeStore(rows())
      )

      await expect(service.findOne(commentId)).rejects.toBeInstanceOf(
        NotFoundException
      )
      await expect(service.findOne(postId)).resolves.toMatchObject({
        authorId: 'u1',
      })
    })
  })
})
