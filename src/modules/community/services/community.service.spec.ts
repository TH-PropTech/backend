import { ForbiddenException, NotFoundException } from '@nestjs/common'
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
    status: 'approved',
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
    expect(entryRepository.delete).toHaveBeenCalledTimes(1)
    expect(entryRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ commentsCount: 0 })
    )
  })

  it('deletes every nested reply and lowers commentsCount by the full amount removed', async () => {
    const { service, entryRepository } = createService()
    const childId = new ObjectId('507f1f77bcf86cd799439021')
    const grandChildId = new ObjectId('507f1f77bcf86cd799439022')
    entryRepository.findOne
      .mockResolvedValueOnce({
        _id: new ObjectId(commentId),
        kind: 'comment',
        postId,
        authorId: 'u1',
      })
      .mockResolvedValueOnce(post({ commentsCount: 5 }))
    entryRepository.find
      .mockResolvedValueOnce([{ _id: childId }])
      .mockResolvedValueOnce([{ _id: grandChildId }])
      .mockResolvedValueOnce([])

    await service.deleteComment(commentId)

    expect(entryRepository.delete).toHaveBeenCalledWith({
      kind: 'comment',
      _id: { $in: [childId, grandChildId] },
    })
    expect(entryRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ commentsCount: 2 })
    )
  })

  it('refuses to delete a comment owned by someone else when an owner is required', async () => {
    const { service, entryRepository } = createService()
    entryRepository.findOne.mockResolvedValue({
      _id: new ObjectId(commentId),
      kind: 'comment',
      postId,
      authorId: 'u1',
    })

    await expect(service.deleteComment(commentId, 'u2')).rejects.toBeInstanceOf(
      ForbiddenException
    )
    expect(entryRepository.delete).not.toHaveBeenCalled()
  })

  it('lets the author delete their own comment', async () => {
    const { service, entryRepository } = createService()
    entryRepository.findOne
      .mockResolvedValueOnce({
        _id: new ObjectId(commentId),
        kind: 'comment',
        postId,
        authorId: 'u1',
      })
      .mockResolvedValueOnce(post({ commentsCount: 1 }))

    await expect(
      service.deleteComment(commentId, 'u1')
    ).resolves.toBeUndefined()
    expect(entryRepository.delete).toHaveBeenCalledWith({
      _id: new ObjectId(commentId),
      kind: 'comment',
    })
  })

  it('lets the author delete their own post without a violation notification', async () => {
    const { service, entryRepository, notificationRepository } = createService()
    entryRepository.findOne.mockResolvedValue(post({ authorId: 'u1' }))

    await service.deleteOwnPost(postId, 'u1')

    expect(notificationRepository.save).not.toHaveBeenCalled()
    expect(entryRepository.delete).toHaveBeenCalledWith({
      _id: new ObjectId(postId),
      kind: 'post',
    })
  })

  it('refuses to delete a post owned by someone else', async () => {
    const { service, entryRepository } = createService()
    entryRepository.findOne.mockResolvedValue(post({ authorId: 'u1' }))

    await expect(service.deleteOwnPost(postId, 'u2')).rejects.toBeInstanceOf(
      ForbiddenException
    )
    expect(entryRepository.delete).not.toHaveBeenCalled()
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

  it('findAllApproved filters kind, approved, topic, project and keyword, newest first, paginated', async () => {
    const { service, entryRepository } = createService()
    await service.findAllApproved({
      topic: 'review',
      search: 'abc',
      project: 'Landmark 81',
      page: 3,
      limit: 10,
    })
    expect(entryRepository.find).toHaveBeenCalledWith({
      where: {
        kind: 'post',
        status: 'approved',
        topic: 'review',
        $or: [
          { title: { $regex: 'abc', $options: 'i' } },
          { content: { $regex: 'abc', $options: 'i' } },
          { projectName: { $regex: 'abc', $options: 'i' } },
          { authorName: { $regex: 'abc', $options: 'i' } },
        ],
        projectName: { $regex: '^Landmark 81$', $options: 'i' },
      },
      order: { createdAt: 'DESC' },
      skip: 20,
      take: 10,
    })
  })

  it('findAllApproved escapes regex metacharacters in user input', async () => {
    const { service, entryRepository } = createService()
    await service.findAllApproved({ search: '(a+)+$', project: 'A.B' })
    const [query] = entryRepository.find.mock.calls[0] as [
      {
        where: {
          $or: { title: { $regex: string } }[]
          projectName: { $regex: string }
        }
      },
    ]
    expect(query.where.$or[0]?.title.$regex).toBe('\\(a\\+\\)\\+\\$')
    expect(query.where.projectName.$regex).toBe('^A\\.B$')
  })

  it('findAllApproved defaults to the first page of 20 and caps the page size at 50', async () => {
    const { service, entryRepository } = createService()
    await service.findAllApproved()
    expect(entryRepository.find).toHaveBeenLastCalledWith({
      where: { kind: 'post', status: 'approved' },
      order: { createdAt: 'DESC' },
      skip: 0,
      take: 20,
    })

    await service.findAllApproved({ limit: 9999, page: -4 })
    expect(entryRepository.find).toHaveBeenLastCalledWith(
      expect.objectContaining({ skip: 0, take: 50 })
    )
  })

  it('getStats counts distinct contributors and posts per project over approved posts', async () => {
    const { service, entryRepository } = createService()
    entryRepository.find.mockResolvedValue([
      { authorId: 'u1', projectName: 'A' },
      { authorId: 'u1', projectName: 'B' },
      { authorId: 'u2', projectName: 'A' },
      { authorId: 'u3', projectName: '' },
    ])

    await expect(service.getStats()).resolves.toEqual({
      contributorCount: 3,
      projectCount: 2,
      projects: [
        { name: 'A', posts: 2 },
        { name: 'B', posts: 1 },
      ],
    })
    expect(entryRepository.find).toHaveBeenCalledWith({
      where: { kind: 'post', status: 'approved' },
      select: ['authorId', 'projectName'],
    })
  })

  it('getStats returns zeros when there are no approved posts', async () => {
    const { service } = createService()
    await expect(service.getStats()).resolves.toEqual({
      contributorCount: 0,
      projectCount: 0,
      projects: [],
    })
  })

  it('createPost keeps only https images and at most five', async () => {
    const { service } = createService()
    const result = await service.createPost('u1', 'U', 'tenant', {
      title: 't',
      content: 'c',
      projectName: 'p',
      topic: 'qa',
      images: [
        'blob:http://localhost/abc',
        'file:///tmp/a.jpg',
        'http://insecure/a.jpg',
        ...Array.from({ length: 7 }, (_, i) => `https://cdn.example/${i}.jpg`),
      ],
    } as never)
    expect(result.images).toHaveLength(5)
    expect(result.images.every(url => url.startsWith('https://'))).toBe(true)
  })

  it('hides unapproved posts from the public findOne and blocks upvote/comment on them', async () => {
    const { service, entryRepository } = createService()
    entryRepository.findOne.mockResolvedValue(post({ status: 'pending' }))

    await expect(service.findOne(postId)).rejects.toBeInstanceOf(
      NotFoundException
    )
    await expect(service.upvote(postId, 'u1')).rejects.toBeInstanceOf(
      NotFoundException
    )
    await expect(
      service.addComment(postId, 'u1', 'U', 'tenant', { content: 'x' })
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(entryRepository.save).not.toHaveBeenCalled()
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
