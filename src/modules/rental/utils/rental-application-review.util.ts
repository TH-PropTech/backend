import { createHash } from 'node:crypto'
import type { RentalPackageRecord } from '../../properties/utils/rental-package.util'
import type { RentalExecutionPolicyRef } from '../../rental-flow-config/utils/rental-execution-policy.util'

export const RENTAL_REVIEW_DISCLOSURE_VERSION = 'rental-review-v1'

export const RENTAL_REVIEW_DISCLOSURES = [
  {
    id: 'listing-terms',
    title: 'Thông tin căn hộ và gói thuê',
    body: 'Thông tin căn hộ, thời hạn, tiền thuê và tiền cọc được chốt theo gói đang được phê duyệt tại thời điểm gửi hồ sơ.',
    required: true,
  },
  {
    id: 'pre-contract-request',
    title: 'Đây là yêu cầu thuê trước hợp đồng',
    body: 'Hồ sơ này chỉ là yêu cầu để chủ nhà xem xét, chưa phải hợp đồng thuê và chưa làm phát sinh nghĩa vụ ký kết.',
    required: true,
  },
  {
    id: 'future-payment-and-signing',
    title: 'Các bước cọc, thanh toán và ký',
    body: 'Nếu được chấp thuận, hệ thống mới mở thỏa thuận cọc, thanh toán qua provider sandbox và quy trình ký theo trạng thái hợp đồng.',
    required: true,
  },
] as const

export type RentalReviewDisclosure = (typeof RENTAL_REVIEW_DISCLOSURES)[number]

export interface RentalApplicationListingSnapshot {
  title: string
  address: string
  area: number
  status: string
  capturedAt: Date
}

export interface RentalApplicationReviewSnapshot {
  disclosureVersion: string
  disclosureHash: string
  acknowledgedDisclosureIds: string[]
  acknowledgedAt: Date
  reviewHash: string
  termsRef?:
    | {
        key: string
        version: number
        contentHash: string
      }
    | undefined
  termsAcceptedAt?: Date | undefined
  flowProfileRef?:
    | {
        profileId: string
        version: number
        hash: string
      }
    | undefined
  executionPolicySnapshot?: RentalExecutionPolicyRef | undefined
}

export function buildRentalDisclosureHash(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: RENTAL_REVIEW_DISCLOSURE_VERSION,
        items: RENTAL_REVIEW_DISCLOSURES,
      })
    )
    .digest('hex')
}

export function buildRentalReviewHash(input: {
  listing: RentalApplicationListingSnapshot
  packageSnapshot: RentalPackageRecord
  disclosureVersion: string
  disclosureHash: string
  acknowledgedDisclosureIds: string[]
  termsRef?:
    | {
        key: string
        version: number
        contentHash: string
      }
    | undefined
  flowProfileRef?:
    | {
        profileId: string
        version: number
        hash: string
      }
    | undefined
  executionPolicySnapshot?: RentalExecutionPolicyRef | undefined
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        listing: {
          ...input.listing,
          capturedAt: input.listing.capturedAt.toISOString(),
        },
        packageSnapshot: {
          ...input.packageSnapshot,
          capturedAt: new Date(
            input.packageSnapshot.capturedAt ?? input.listing.capturedAt
          ).toISOString(),
        },
        disclosureVersion: input.disclosureVersion,
        disclosureHash: input.disclosureHash,
        acknowledgedDisclosureIds: [...input.acknowledgedDisclosureIds].sort(),
        ...(input.termsRef ? { termsRef: input.termsRef } : {}),
        ...(input.flowProfileRef
          ? { flowProfileRef: input.flowProfileRef }
          : {}),
        ...(input.executionPolicySnapshot
          ? { executionPolicySnapshot: input.executionPolicySnapshot }
          : {}),
      })
    )
    .digest('hex')
}

export function hasRequiredRentalDisclosures(ids: string[]): boolean {
  const acknowledged = new Set(ids)
  return RENTAL_REVIEW_DISCLOSURES.every(item => acknowledged.has(item.id))
}
