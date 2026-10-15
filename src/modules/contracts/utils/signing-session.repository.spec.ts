import type { Repository } from 'typeorm'
import type { SmartCaSigningSession } from '../schemas/smartca-signing-session.schema'
import { KindScopedSmartCaSigningRepository } from './signing-session.repository'

function fakeRepository(): {
  find: jest.Mock
  findOne: jest.Mock
  create: jest.Mock
  save: jest.Mock
  remove: jest.Mock
} {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((data: object) => ({ ...data })),
    save: jest.fn((entity: object) => Promise.resolve(entity)),
    remove: jest.fn((entity: object) => Promise.resolve(entity)),
  }
}

function asRepository(
  repo: ReturnType<typeof fakeRepository>
): Repository<SmartCaSigningSession> {
  return repo as unknown as Repository<SmartCaSigningSession>
}

describe('KindScopedSmartCaSigningRepository', () => {
  it('adds kind=session to every read of the session facade, overriding a caller kind', async () => {
    const repo = fakeRepository()
    const session = new KindScopedSmartCaSigningRepository(
      asRepository(repo),
      'session'
    )

    await session.findOne({
      where: { contractId: 'c-1', kind: 'grant' },
    })
    await session.find({
      where: { contractId: 'c-1' },
      order: { createdAt: 'DESC' },
    })

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { contractId: 'c-1', kind: 'session' },
    })
    expect(repo.find).toHaveBeenCalledWith({
      where: { contractId: 'c-1', kind: 'session' },
      order: { createdAt: 'DESC' },
    })
  })

  it('adds kind=grant to every read of the grant facade (token lookup stays scoped)', async () => {
    const repo = fakeRepository()
    const grant = new KindScopedSmartCaSigningRepository(
      asRepository(repo),
      'grant'
    )

    await grant.findOne({ where: { tokenHash: 'h-1' } })

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { tokenHash: 'h-1', kind: 'grant' },
    })
  })

  it('sets kind on create and on save, and returns the saved entity', async () => {
    const repo = fakeRepository()
    const grant = new KindScopedSmartCaSigningRepository(
      asRepository(repo),
      'grant'
    )

    const created = grant.create({ tokenHash: 'h-1', userId: 'u-1' })
    expect(created).toMatchObject({ kind: 'grant', tokenHash: 'h-1' })

    const saved = await grant.save(created)
    expect(saved.kind).toBe('grant')
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'grant', tokenHash: 'h-1' })
    )
  })

  it('refuses to save an entity that belongs to the other kind', async () => {
    const repo = fakeRepository()
    const session = new KindScopedSmartCaSigningRepository(
      asRepository(repo),
      'session'
    )

    await expect(session.save({ kind: 'grant' } as never)).rejects.toThrow(
      'smartca signing kind mismatch: expected session, got grant'
    )
    expect(repo.save).not.toHaveBeenCalled()
  })

  it('removes through the facade only for the matching kind', async () => {
    const repo = fakeRepository()
    const session = new KindScopedSmartCaSigningRepository(
      asRepository(repo),
      'session'
    )

    await session.remove({ kind: 'session', _id: 'x' } as never)
    expect(repo.remove).toHaveBeenCalledTimes(1)

    await expect(
      session.remove({ kind: 'grant', _id: 'y' } as never)
    ).rejects.toThrow('smartca signing kind mismatch')
    expect(repo.remove).toHaveBeenCalledTimes(1)
  })
})
