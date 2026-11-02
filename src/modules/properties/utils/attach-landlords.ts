import { ObjectId } from 'mongodb'
import type { FindOptionsWhere, Repository } from 'typeorm'
import type { User } from '../../users/schemas/user.schema'
import type { Apartment } from '../schemas/apartment.schema'

export type ApartmentWithLandlord = Apartment & { landlord?: User | null }

/** Gắn hồ sơ chủ nhà hiện tại vào danh sách căn hộ bằng một truy vấn gộp. */
export async function attachCurrentLandlords(
  userRepository: Repository<User>,
  apartments: readonly Apartment[]
): Promise<ApartmentWithLandlord[]> {
  const landlordIds = [
    ...new Set(
      apartments
        .map(apartment => apartment.landlordId)
        .filter(landlordId => ObjectId.isValid(landlordId))
    ),
  ]

  const landlords =
    landlordIds.length > 0
      ? await userRepository.find({
          where: {
            _id: {
              $in: landlordIds.map(landlordId => new ObjectId(landlordId)),
            },
          } as unknown as FindOptionsWhere<User>,
        })
      : []
  const landlordMap = new Map(
    landlords.map(landlord => [landlord._id.toString(), landlord])
  )

  return apartments.map(apartment => ({
    ...apartment,
    landlord: landlordMap.get(apartment.landlordId) ?? null,
  }))
}
