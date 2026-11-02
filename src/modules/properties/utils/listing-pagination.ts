import { BadRequestException } from '@nestjs/common'

export interface ListingPage {
  skip: number
  take: number
}

function parsePositiveInt(
  raw: string | undefined,
  name: string
): number | undefined {
  if (raw === undefined || raw === '') return undefined
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestException(`${name} phải là số nguyên dương`)
  }
  return Number(raw)
}

/**
 * Không có page/limit thì lấy trang đầu với kích thước tối đa, giữ tương thích với client cũ.
 * limit vượt trần hoặc page < 1 bị từ chối với 400.
 */
export function parseListingPage(
  rawPage: string | undefined,
  rawLimit: string | undefined,
  maxLimit: number
): ListingPage {
  const page = parsePositiveInt(rawPage, 'page') ?? 1
  const limit = parsePositiveInt(rawLimit, 'limit') ?? maxLimit
  if (page < 1) throw new BadRequestException('page phải từ 1 trở lên')
  if (limit < 1 || limit > maxLimit) {
    throw new BadRequestException(`limit phải từ 1 đến ${maxLimit}`)
  }
  return { skip: (page - 1) * limit, take: limit }
}
