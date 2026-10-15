import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { KindScopedOtpRepository } from './otp.repository'
import type { Otp } from '../schemas/otp.schema'
import { InMemoryOtpRepository } from './in-memory-otp-repository'

describe('KindScopedOtpRepository', () => {
  let store: InMemoryOtpRepository
  let asRepository: Repository<Otp>

  beforeEach(() => {
    store = new InMemoryOtpRepository()
    asRepository = store as unknown as Repository<Otp>
  })

  it('adds the kind to every find/findOne where clause and keeps caller filters', async () => {
    const email = new KindScopedOtpRepository(asRepository, 'email')
    const sameId = new ObjectId()
    store.seed({
      _id: sameId,
      kind: 'transaction',
      email: 'a@x.vn',
      otpCode: '123456',
    })
    store.seed({
      _id: new ObjectId(),
      kind: 'email',
      email: 'a@x.vn',
      otpCode: '123456',
    })

    const rows = await email.find({ where: { otpCode: '123456' } })
    const one = await email.findOne({ where: { _id: sameId } })

    expect(rows.map(r => r.kind)).toEqual(['email'])
    expect(one).toBeNull()
  })

  it('cannot be widened or redirected by a caller-supplied kind', async () => {
    const transaction = new KindScopedOtpRepository(asRepository, 'transaction')
    store.seed({ _id: new ObjectId(), kind: 'email', otpCode: '111111' })
    store.seed({ _id: new ObjectId(), kind: 'transaction', otpCode: '111111' })

    const rows = await transaction.find({
      where: { kind: 'email', otpCode: '111111' },
    })

    expect(rows.map(r => r.kind)).toEqual(['transaction'])
  })

  it('stamps the kind on created rows', () => {
    const email = new KindScopedOtpRepository(asRepository, 'email')

    const created = email.create({ email: 'a@x.vn', otpCode: '654321' })

    expect(created).toEqual({
      kind: 'email',
      email: 'a@x.vn',
      otpCode: '654321',
    })
  })

  it('stamps the kind on save and refuses an entity of another kind', async () => {
    const email = new KindScopedOtpRepository(asRepository, 'email')
    const entity = { otpCode: '999999' } as Otp

    await email.save(entity)
    expect(entity.kind).toBe('email')
    expect(store.rows).toHaveLength(1)

    const foreign = { kind: 'transaction', otpCode: '000000' } as Otp
    await expect(email.save(foreign)).rejects.toThrow(
      'otp kind mismatch: expected email, got transaction'
    )
    expect(store.rows).toHaveLength(1)
  })
})
