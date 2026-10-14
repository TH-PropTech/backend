import type { ObjectLiteral, Repository } from 'typeorm'
import { UserStatus, User } from '../../users/schemas/user.schema'
import { Apartment } from '../../properties/schemas/apartment.schema'
import { Booking } from '../../bookings/schemas/booking.schema'
import { RentalApplication } from '../../rental/schemas/rental-application.schema'
import { Contract } from '../../contracts/schemas/contract.schema'
import { DepositAgreement } from '../../contracts/schemas/deposit-agreement.schema'
import { Payment } from '../../payments/schemas/payment.schema'
import { Dispute } from '../../community/schemas/dispute.schema'
import { PropertyOwnershipTransfer } from '../schemas/property-ownership-transfer.schema'
import { PropertyOwnershipTransferRecord } from '../schemas/property-ownership-transfer-record.schema'
import { OwnershipTransferService } from './ownership-transfer.service'
import { createOwnershipTransferManifest } from '../utils/ownership-transfer.manifest'
import { OwnershipTransferTransactionUnavailableError } from './ownership-transfer.store'

type RepositoryStub<T extends ObjectLiteral> = jest.Mocked<
  Pick<Repository<T>, 'find' | 'findOne' | 'create' | 'save'>
>

function repositoryStub<T extends ObjectLiteral>(): RepositoryStub<T> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  }
}

describe('OwnershipTransferService', () => {
  it('previews all linked records without exposing target credentials', async () => {
    const userRepository = repositoryStub<User>()
    const apartmentRepository = repositoryStub<Apartment>()
    const bookingRepository = repositoryStub<Booking>()
    const applicationRepository = repositoryStub<RentalApplication>()
    const contractRepository = repositoryStub<Contract>()
    const depositRepository = repositoryStub<DepositAgreement>()
    const paymentRepository = repositoryStub<Payment>()
    const disputeRepository = repositoryStub<Dispute>()
    const transferRepository = repositoryStub<PropertyOwnershipTransfer>()
    const recordRepository = repositoryStub<PropertyOwnershipTransferRecord>()

    const target = {
      _id: { toString: () => 'target-id' },
      email: 'owner@example.com',
      role: 'landlord' as const,
      status: UserStatus.ACTIVE,
      passwordHash: 'must-never-leak',
    } as User
    userRepository.findOne.mockResolvedValue(target)
    userRepository.find.mockResolvedValue([target])
    apartmentRepository.find.mockResolvedValue([])
    bookingRepository.find.mockResolvedValue([])
    applicationRepository.find.mockResolvedValue([])
    contractRepository.find.mockResolvedValue([])
    depositRepository.find.mockResolvedValue([])
    paymentRepository.find.mockResolvedValue([])
    disputeRepository.find.mockResolvedValue([])

    const savedTransfer = {
      _id: { toString: () => 'transfer-id' },
      targetLandlordId: 'target-id',
      status: 'previewed',
      expiresAt: new Date('2026-09-20T00:00:00.000Z'),
    } as unknown as PropertyOwnershipTransfer
    transferRepository.create.mockReturnValue(savedTransfer)
    transferRepository.save.mockResolvedValue(savedTransfer)
    recordRepository.create.mockImplementation(
      value => value as PropertyOwnershipTransferRecord
    )
    recordRepository.save.mockResolvedValue(
      {} as PropertyOwnershipTransferRecord
    )

    const service = new OwnershipTransferService(
      userRepository,
      apartmentRepository,
      bookingRepository,
      applicationRepository,
      contractRepository,
      depositRepository,
      paymentRepository,
      disputeRepository,
      transferRepository,
      recordRepository,
      { apply: jest.fn() }
    )

    const response = await service.preview('  OWNER@EXAMPLE.COM ', 'admin-id')

    expect(response.targetUser).toEqual({
      id: 'target-id',
      email: 'owner@example.com',
      role: 'landlord',
    })
    expect(response).not.toHaveProperty('passwordHash')
    expect(response.affectedCounts.apartments).toBe(0)
    expect(userRepository.findOne).toHaveBeenCalledWith({
      where: { email: 'owner@example.com' },
    })
  })

  it('rejects an inactive or non-landlord target before scanning records', async () => {
    const userRepository = repositoryStub<User>()
    const apartmentRepository = repositoryStub<Apartment>()
    const bookingRepository = repositoryStub<Booking>()
    const applicationRepository = repositoryStub<RentalApplication>()
    const contractRepository = repositoryStub<Contract>()
    const depositRepository = repositoryStub<DepositAgreement>()
    const paymentRepository = repositoryStub<Payment>()
    const disputeRepository = repositoryStub<Dispute>()
    const transferRepository = repositoryStub<PropertyOwnershipTransfer>()
    const recordRepository = repositoryStub<PropertyOwnershipTransferRecord>()
    userRepository.findOne.mockResolvedValue({
      _id: { toString: () => 'target-id' },
      email: 'owner@example.com',
      role: 'tenant',
      status: UserStatus.INACTIVE,
    } as User)

    const service = new OwnershipTransferService(
      userRepository,
      apartmentRepository,
      bookingRepository,
      applicationRepository,
      contractRepository,
      depositRepository,
      paymentRepository,
      disputeRepository,
      transferRepository,
      recordRepository,
      { apply: jest.fn() }
    )

    await expect(
      service.preview('owner@example.com', 'admin-id')
    ).rejects.toThrow('Target account must be an active landlord')
    expect(apartmentRepository.find).not.toHaveBeenCalled()
  })

  it('applies a current preview with an idempotency key and returns completed status', async () => {
    const userRepository = repositoryStub<User>()
    const apartmentRepository = repositoryStub<Apartment>()
    const bookingRepository = repositoryStub<Booking>()
    const applicationRepository = repositoryStub<RentalApplication>()
    const contractRepository = repositoryStub<Contract>()
    const depositRepository = repositoryStub<DepositAgreement>()
    const paymentRepository = repositoryStub<Payment>()
    const disputeRepository = repositoryStub<Dispute>()
    const transferRepository = repositoryStub<PropertyOwnershipTransfer>()
    const recordRepository = repositoryStub<PropertyOwnershipTransferRecord>()
    const targetId = '64b000000000000000000001'
    const transferId = '64b000000000000000000002'
    const previewHash = createOwnershipTransferManifest({
      targetLandlordId: targetId,
      records: [],
    }).previewHash
    const target = {
      _id: { toString: () => targetId },
      email: 'owner@example.com',
      role: 'landlord' as const,
      status: UserStatus.ACTIVE,
    } as User
    const transfer = {
      _id: { toString: () => transferId },
      targetLandlordId: targetId,
      initiatedBy: 'admin-id',
      status: 'previewed',
      previewHash,
      idempotencyKey: null,
      sourceOwnerIds: [],
      affectedCounts: {
        apartments: 0,
        openBookings: 0,
        openApplications: 0,
        contracts: 0,
        depositAgreements: 0,
        payments: 0,
        disputes: 0,
      },
      immutableCounts: {
        contracts: 0,
        depositAgreements: 0,
        payments: 0,
        disputes: 0,
      },
      conflicts: [],
      expiresAt: new Date('2099-09-20T00:00:00.000Z'),
      completedAt: null,
    } as unknown as PropertyOwnershipTransfer
    userRepository.findOne.mockResolvedValue(target)
    userRepository.find.mockResolvedValue([target])
    apartmentRepository.find.mockResolvedValue([])
    bookingRepository.find.mockResolvedValue([])
    applicationRepository.find.mockResolvedValue([])
    contractRepository.find.mockResolvedValue([])
    depositRepository.find.mockResolvedValue([])
    paymentRepository.find.mockResolvedValue([])
    disputeRepository.find.mockResolvedValue([])
    transferRepository.findOne.mockResolvedValue(transfer)
    recordRepository.find.mockResolvedValue([])
    const report = {
      updatedApartments: 0,
      reassignedBookings: 0,
      reassignedApplications: 0,
      preservedContracts: 0,
      preservedDepositAgreements: 0,
      preservedPayments: 0,
      preservedDisputes: 0,
      auditRecordCount: 0,
    }
    const store = {
      apply: jest.fn().mockImplementation(() => {
        transfer.status = 'completed'
        transfer.idempotencyKey = 'idem-1'
        transfer.completedAt = new Date('2026-09-19T00:00:00.000Z')
        transfer.finalReport = report
        return report
      }),
    }

    const service = new OwnershipTransferService(
      userRepository,
      apartmentRepository,
      bookingRepository,
      applicationRepository,
      contractRepository,
      depositRepository,
      paymentRepository,
      disputeRepository,
      transferRepository,
      recordRepository,
      store
    )

    const response = await service.apply(transferId, { previewHash }, 'idem-1')

    expect(response.status).toBe('completed')
    expect(store.apply).toHaveBeenCalledWith({
      transferId,
      targetLandlordId: targetId,
      idempotencyKey: 'idem-1',
      records: [],
      expectedPreviewHash: previewHash,
    })
  })

  it('fails before mutation when the idempotency key is missing', async () => {
    const service = new OwnershipTransferService(
      repositoryStub<User>(),
      repositoryStub<Apartment>(),
      repositoryStub<Booking>(),
      repositoryStub<RentalApplication>(),
      repositoryStub<Contract>(),
      repositoryStub<DepositAgreement>(),
      repositoryStub<Payment>(),
      repositoryStub<Dispute>(),
      repositoryStub<PropertyOwnershipTransfer>(),
      repositoryStub<PropertyOwnershipTransferRecord>(),
      { apply: jest.fn() }
    )

    await expect(
      service.apply(
        '64b000000000000000000002',
        {
          previewHash: 'sha256:' + 'a'.repeat(64),
        },
        undefined
      )
    ).rejects.toThrow('Idempotency-Key header is required')
  })

  it('maps an unavailable MongoDB transaction to a retry-safe error', async () => {
    const userRepository = repositoryStub<User>()
    const apartmentRepository = repositoryStub<Apartment>()
    const bookingRepository = repositoryStub<Booking>()
    const applicationRepository = repositoryStub<RentalApplication>()
    const contractRepository = repositoryStub<Contract>()
    const depositRepository = repositoryStub<DepositAgreement>()
    const paymentRepository = repositoryStub<Payment>()
    const disputeRepository = repositoryStub<Dispute>()
    const transferRepository = repositoryStub<PropertyOwnershipTransfer>()
    const recordRepository = repositoryStub<PropertyOwnershipTransferRecord>()
    const targetId = '64b000000000000000000001'
    const transferId = '64b000000000000000000002'
    const previewHash = createOwnershipTransferManifest({
      targetLandlordId: targetId,
      records: [],
    }).previewHash
    transferRepository.findOne.mockResolvedValue({
      _id: { toString: () => transferId },
      targetLandlordId: targetId,
      status: 'previewed',
      previewHash,
      conflicts: [],
      expiresAt: new Date('2099-09-20T00:00:00.000Z'),
    } as unknown as PropertyOwnershipTransfer)
    userRepository.findOne.mockResolvedValue({
      _id: { toString: () => targetId },
      email: 'owner@example.com',
      role: 'landlord',
      status: UserStatus.ACTIVE,
    } as User)
    userRepository.find.mockResolvedValue([])
    apartmentRepository.find.mockResolvedValue([])
    bookingRepository.find.mockResolvedValue([])
    applicationRepository.find.mockResolvedValue([])
    contractRepository.find.mockResolvedValue([])
    depositRepository.find.mockResolvedValue([])
    paymentRepository.find.mockResolvedValue([])
    disputeRepository.find.mockResolvedValue([])
    recordRepository.find.mockResolvedValue([])
    const store = {
      apply: jest
        .fn()
        .mockRejectedValue(
          new OwnershipTransferTransactionUnavailableError(
            'transactions unavailable'
          )
        ),
    }
    const service = new OwnershipTransferService(
      userRepository,
      apartmentRepository,
      bookingRepository,
      applicationRepository,
      contractRepository,
      depositRepository,
      paymentRepository,
      disputeRepository,
      transferRepository,
      recordRepository,
      store
    )

    await expect(
      service.apply(transferId, { previewHash }, 'idem-2')
    ).rejects.toMatchObject({ status: 422 })
  })
})
