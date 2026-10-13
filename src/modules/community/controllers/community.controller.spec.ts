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
})
