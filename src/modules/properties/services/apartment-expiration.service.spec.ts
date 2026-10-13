import { ApartmentExpirationService } from './apartment-expiration.service'
import type { ApartmentsService } from './apartments.service'

function buildContext(): {
  service: ApartmentExpirationService
  apartments: { checkExpiration: jest.Mock; remindExpiringSoon: jest.Mock }
} {
  const apartments = {
    checkExpiration: jest.fn().mockResolvedValue(undefined),
    remindExpiringSoon: jest.fn().mockResolvedValue(undefined),
  }
  const service = new ApartmentExpirationService(
    apartments as unknown as ApartmentsService
  )
  return { service, apartments }
}

describe('ApartmentExpirationService', () => {
  it('expires overdue listings on the hourly job', async () => {
    const { service, apartments } = buildContext()

    await service.expireOverdueListings()

    expect(apartments.checkExpiration).toHaveBeenCalledTimes(1)
  })

  it('reminds landlords on the daily job', async () => {
    const { service, apartments } = buildContext()

    await service.remindExpiringListings()

    expect(apartments.remindExpiringSoon).toHaveBeenCalledTimes(1)
  })

  it('runs the expiration check once at startup', async () => {
    const { service, apartments } = buildContext()

    await service.onApplicationBootstrap()

    expect(apartments.checkExpiration).toHaveBeenCalledTimes(1)
    expect(apartments.remindExpiringSoon).not.toHaveBeenCalled()
  })

  it('swallows job failures so the scheduler keeps running', async () => {
    const { service, apartments } = buildContext()
    apartments.checkExpiration.mockRejectedValue(new Error('db down'))
    apartments.remindExpiringSoon.mockRejectedValue(new Error('db down'))

    await expect(service.expireOverdueListings()).resolves.toBeUndefined()
    await expect(service.remindExpiringListings()).resolves.toBeUndefined()
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined()
  })
})
