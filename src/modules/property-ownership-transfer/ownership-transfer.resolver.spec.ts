import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { Apartment } from '../apartments/schemas/apartment.schema'
import { Contract } from '../contracts/schemas/contract.schema'
import { PropertyOwnershipTransfer } from './schemas/property-ownership-transfer.schema'
import { PropertyOwnershipTransferRecord } from './schemas/property-ownership-transfer-record.schema'
import { OwnershipTransferResolver } from './ownership-transfer.resolver'

describe('OwnershipTransferResolver', () => {
  it('allows a completed successor to read a contract workspace but not sign', async () => {
    const apartmentId = new ObjectId().toString()
    const apartmentRepository = {
      findOne: jest.fn().mockResolvedValue({ landlordId: 'successor-id' }),
    }
    const transferRepository = {
      find: jest.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          targetLandlordId: 'successor-id',
          status: 'completed',
        },
      ]),
    }
    const recordRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ entityType: 'apartment', entityId: apartmentId }),
    }
    const resolver = new OwnershipTransferResolver(
      apartmentRepository as unknown as Repository<Apartment>,
      transferRepository as unknown as Repository<PropertyOwnershipTransfer>,
      recordRepository as unknown as Repository<PropertyOwnershipTransferRecord>
    )
    const contract = {
      propertyId: apartmentId,
      landlordId: 'original-landlord',
      tenantId: 'tenant-id',
    } as Contract

    await expect(
      resolver.resolveContractAccess('successor-id', contract, false)
    ).resolves.toEqual({
      canReadWorkspace: true,
      canSign: false,
      isOriginalParticipant: false,
      isSuccessorOwner: true,
    })
  })

  it('keeps original participants able to read and sign without a transfer lookup', async () => {
    const apartmentRepository = {
      findOne: jest.fn(),
    }
    const transferRepository = {
      find: jest.fn(),
    }
    const recordRepository = {
      findOne: jest.fn(),
    }
    const resolver = new OwnershipTransferResolver(
      apartmentRepository as unknown as Repository<Apartment>,
      transferRepository as unknown as Repository<PropertyOwnershipTransfer>,
      recordRepository as unknown as Repository<PropertyOwnershipTransferRecord>
    )

    await expect(
      resolver.resolveContractAccess(
        'original-landlord',
        {
          propertyId: new ObjectId().toString(),
          landlordId: 'original-landlord',
          tenantId: 'tenant-id',
        },
        false
      )
    ).resolves.toEqual({
      canReadWorkspace: true,
      canSign: true,
      isOriginalParticipant: true,
      isSuccessorOwner: false,
    })
    expect(transferRepository.find).not.toHaveBeenCalled()
  })

  it('denies an unrelated actor when no completed transfer relation exists', async () => {
    const resolver = new OwnershipTransferResolver(
      {
        findOne: jest.fn().mockResolvedValue({ landlordId: 'owner-id' }),
      } as unknown as Repository<Apartment>,
      {
        find: jest.fn().mockResolvedValue([]),
      } as unknown as Repository<PropertyOwnershipTransfer>,
      {
        findOne: jest.fn(),
      } as unknown as Repository<PropertyOwnershipTransferRecord>
    )

    await expect(
      resolver.resolveContractAccess(
        'outsider-id',
        {
          propertyId: new ObjectId().toString(),
          landlordId: 'owner-id',
          tenantId: 'tenant-id',
        },
        false
      )
    ).resolves.toEqual({
      canReadWorkspace: false,
      canSign: false,
      isOriginalParticipant: false,
      isSuccessorOwner: false,
    })
  })

  it('authorizes successor reads for linked deposit, payment, and dispute records', async () => {
    const apartmentId = new ObjectId().toString()
    const resolver = new OwnershipTransferResolver(
      {
        findOne: jest.fn().mockResolvedValue({ landlordId: 'successor-id' }),
      } as unknown as Repository<Apartment>,
      {
        find: jest.fn().mockResolvedValue([
          {
            _id: new ObjectId(),
            targetLandlordId: 'successor-id',
            status: 'completed',
          },
        ]),
      } as unknown as Repository<PropertyOwnershipTransfer>,
      {
        findOne: jest.fn().mockResolvedValue({
          entityType: 'apartment',
          entityId: apartmentId,
        }),
      } as unknown as Repository<PropertyOwnershipTransferRecord>
    )

    await expect(
      resolver.canAccessDeposit(
        'successor-id',
        {
          propertyId: apartmentId,
          landlordId: 'original-landlord',
          tenantId: 'tenant-id',
        },
        false
      )
    ).resolves.toBe(true)
    await expect(
      resolver.canAccessPayment(
        'successor-id',
        { landlordId: 'original-landlord', tenantId: 'tenant-id' },
        {
          propertyId: apartmentId,
          landlordId: 'original-landlord',
        },
        false
      )
    ).resolves.toBe(true)
    await expect(
      resolver.canAccessDispute(
        'successor-id',
        { landlordId: 'original-landlord', tenantId: 'tenant-id' },
        {
          propertyId: apartmentId,
          landlordId: 'original-landlord',
        },
        false
      )
    ).resolves.toBe(true)
  })

  it('denies successor access when the transfer is missing or not completed', async () => {
    const resolver = new OwnershipTransferResolver(
      {
        findOne: jest.fn().mockResolvedValue({ landlordId: 'successor-id' }),
      } as unknown as Repository<Apartment>,
      {
        find: jest.fn().mockResolvedValue([
          {
            _id: new ObjectId(),
            targetLandlordId: 'successor-id',
            status: 'previewed',
          },
        ]),
      } as unknown as Repository<PropertyOwnershipTransfer>,
      {
        findOne: jest.fn(),
      } as unknown as Repository<PropertyOwnershipTransferRecord>
    )

    await expect(
      resolver.canAccessPayment(
        'successor-id',
        { landlordId: 'original-landlord', tenantId: 'tenant-id' },
        {
          propertyId: new ObjectId().toString(),
          landlordId: 'original-landlord',
        },
        false
      )
    ).resolves.toBe(false)
  })
})
