import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { KindScopedReviewCaseRepository } from './review-case.repository'
import type { ReviewCase } from '../schemas/review-case.schema'

describe('KindScopedReviewCaseRepository', () => {
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value: Partial<ReviewCase>) => value as ReviewCase),
    save: jest.fn((value: ReviewCase) => Promise.resolve(value)),
  }
  const asRepository = repo as unknown as Repository<ReviewCase>

  beforeEach(() => jest.clearAllMocks())

  it('adds the kind to every find/findOne where clause and keeps order', async () => {
    const listing = new KindScopedReviewCaseRepository(asRepository, 'listing')
    const id = new ObjectId()

    await listing.find({ order: { createdAt: 'DESC' } })
    await listing.findOne({ where: { _id: id, status: 'pending' } })

    expect(repo.find).toHaveBeenCalledWith({
      where: { kind: 'listing' },
      order: { createdAt: 'DESC' },
    })
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { _id: id, status: 'pending', kind: 'listing' },
    })
  })

  it('cannot be widened or redirected by a caller-supplied kind', async () => {
    const safety = new KindScopedReviewCaseRepository(asRepository, 'safety')

    await safety.find({ where: { kind: 'listing', category: 'spam' } })

    expect(repo.find).toHaveBeenCalledWith({
      where: { kind: 'safety', category: 'spam' },
    })
  })

  it('stamps the kind on created rows', () => {
    const safety = new KindScopedReviewCaseRepository(asRepository, 'safety')

    const created = safety.create({ reporterId: 'tenant-1', status: 'pending' })

    expect(created).toEqual({
      kind: 'safety',
      reporterId: 'tenant-1',
      status: 'pending',
    })
  })

  it('saves its own kind and refuses to write a row of another kind', async () => {
    const listing = new KindScopedReviewCaseRepository(asRepository, 'listing')
    const loaded = { _id: new ObjectId(), kind: 'listing' } as ReviewCase

    await listing.save(loaded)
    expect(repo.save).toHaveBeenCalledWith(loaded)

    const foreign = { _id: new ObjectId(), kind: 'safety' } as ReviewCase
    await expect(listing.save(foreign)).rejects.toThrow(
      'review case kind mismatch'
    )
    expect(repo.save).toHaveBeenCalledTimes(1)
  })
})
