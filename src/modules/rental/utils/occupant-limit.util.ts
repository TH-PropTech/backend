import { BadRequestException } from '@nestjs/common'

/** Giới hạn do Chủ nhà đặt trên tin; tin cũ không có giá trị thì không chặn. */
export function assertWithinApartmentOccupantLimit(
  maxOccupants: number | null | undefined,
  occupants: number
): void {
  if (maxOccupants === null || maxOccupants === undefined) return
  if (occupants > maxOccupants) {
    throw new BadRequestException(
      `Căn hộ này cho phép tối đa ${maxOccupants} người ở.`
    )
  }
}
