import { ObjectId } from 'mongodb'
import { UsersController } from './users.controller'

function userWithDevices(): Record<string, unknown> {
  return {
    _id: new ObjectId(),
    email: 'a@b.c',
    passwordHash: 'secret',
    pin: { hash: 'h', setAt: new Date(1) },
    twoFactor: { enabled: true, secret: 's', enabledAt: new Date(2) },
    smartOTP: {
      enabled: true,
      maxDevices: 2,
      registeredDevices: 1,
      otpAttempts: 0,
      devices: [
        {
          deviceId: 'd1',
          deviceName: 'Phone',
          publicKey: 'PUB',
          status: 'ACTIVE',
        },
      ],
    },
  }
}

describe('UsersController smartOTP exposure', () => {
  it('GET /users/me omits smartOTP.devices but keeps the other smartOTP fields', async () => {
    const user = userWithDevices()
    const repo = { findOne: jest.fn().mockResolvedValue(user) }
    const controller = new UsersController(repo as never)
    const result = (await controller.getMe({
      user: { _id: (user._id as ObjectId).toHexString() },
    })) as Record<string, unknown>

    expect(JSON.stringify(result)).not.toContain('PUB')
    expect(result.smartOTP).toEqual({
      enabled: true,
      maxDevices: 2,
      registeredDevices: 1,
      otpAttempts: 0,
    })
    expect(result).not.toHaveProperty('passwordHash')
    expect(result.hasPin).toBe(true)
    // the stored entity is not mutated
    expect((user.smartOTP as { devices?: unknown[] }).devices).toHaveLength(1)
  })

  it('GET /users omits smartOTP.devices for every user', async () => {
    const repo = {
      find: jest.fn().mockResolvedValue([userWithDevices(), userWithDevices()]),
    }
    const controller = new UsersController(repo as never)
    const result = await controller.getAll()
    expect(JSON.stringify(result)).not.toContain('PUB')
    expect(result).toHaveLength(2)
    expect((result[0] as { smartOTP?: unknown }).smartOTP).toEqual({
      enabled: true,
      maxDevices: 2,
      registeredDevices: 1,
      otpAttempts: 0,
    })
  })

  it('leaves users without smartOTP untouched', async () => {
    const user = { _id: new ObjectId(), email: 'x@y.z' }
    const repo = { findOne: jest.fn().mockResolvedValue(user) }
    const controller = new UsersController(repo as never)
    const result = (await controller.getMe({
      user: { _id: user._id.toHexString() },
    })) as Record<string, unknown>
    expect(result).not.toHaveProperty('smartOTP')
  })
})
