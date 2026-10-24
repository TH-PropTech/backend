import { CommunityController } from './community.controller'

describe('CommunityController moderation endpoints', () => {
  it('delegates post deletion and returns success', async () => {
    const service = {
      deletePost: jest.fn().mockResolvedValue(undefined),
      deleteComment: jest.fn(),
    }
    const controller = new CommunityController(service as never)

    await expect(controller.deletePost('post-1')).resolves.toEqual({
      success: true,
    })
    expect(service.deletePost).toHaveBeenCalledWith('post-1')
  })

  it('delegates comment deletion and returns success', async () => {
    const service = {
      deletePost: jest.fn(),
      deleteComment: jest.fn().mockResolvedValue(undefined),
    }
    const controller = new CommunityController(service as never)

    await expect(controller.deleteComment('comment-1')).resolves.toEqual({
      success: true,
    })
    expect(service.deleteComment).toHaveBeenCalledWith('comment-1')
  })

  it('passes list filters and numeric paging to the service', async () => {
    const service = { findAllApproved: jest.fn().mockResolvedValue([]) }
    const controller = new CommunityController(service as never)

    await controller.getPosts('qa', 'kw', 'Landmark', '2', '10')

    expect(service.findAllApproved).toHaveBeenCalledWith({
      topic: 'qa',
      search: 'kw',
      project: 'Landmark',
      page: 2,
      limit: 10,
    })
  })

  it('leaves paging undefined when the query omits it', async () => {
    const service = { findAllApproved: jest.fn().mockResolvedValue([]) }
    const controller = new CommunityController(service as never)

    await controller.getPosts()

    expect(service.findAllApproved).toHaveBeenCalledWith({
      topic: undefined,
      search: undefined,
      project: undefined,
      page: undefined,
      limit: undefined,
    })
  })

  it('returns community stats from the service', async () => {
    const stats = { contributorCount: 1, projectCount: 1, projects: [] }
    const service = { getStats: jest.fn().mockResolvedValue(stats) }
    const controller = new CommunityController(service as never)

    await expect(controller.getStats()).resolves.toBe(stats)
  })

  it('deletes the requester own post and comment using their user id', async () => {
    const service = {
      deleteOwnPost: jest.fn().mockResolvedValue(undefined),
      deleteComment: jest.fn().mockResolvedValue(undefined),
    }
    const controller = new CommunityController(service as never)
    const req = { user: { _id: 'u1' } } as never

    await expect(controller.deleteOwnPost('p1', req)).resolves.toEqual({
      success: true,
    })
    await expect(controller.deleteOwnComment('c1', req)).resolves.toEqual({
      success: true,
    })
    expect(service.deleteOwnPost).toHaveBeenCalledWith('p1', 'u1')
    expect(service.deleteComment).toHaveBeenCalledWith('c1', 'u1')
  })

  it('rejects own-delete when the token carries no user id', async () => {
    const controller = new CommunityController({} as never)
    const req = { user: {} } as never

    await expect(controller.deleteOwnPost('p1', req)).rejects.toThrow()
    await expect(controller.deleteOwnComment('c1', req)).rejects.toThrow()
  })
})
