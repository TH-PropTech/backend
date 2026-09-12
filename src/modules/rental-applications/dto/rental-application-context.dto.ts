import type { RentalApplicationListingSnapshot } from '../rental-application-review.util'
import type { RentalPackageRecord } from '../../apartments/rental-package.util'

export type RentalApplicationContextReason =
  | 'RENTAL_FLOW_DISABLED'
  | 'LISTING_UNAVAILABLE'
  | 'LEGACY_PRICING'
  | 'NO_ACTIVE_PACKAGE'
  | 'OWNER_NOT_ELIGIBLE'

export interface RentalApplicationContext {
  enabled: boolean
  eligible: boolean
  reasonCode: RentalApplicationContextReason | null
  listing: RentalApplicationListingSnapshot & {
    id: string
    landlordDisplayName: string | null
  }
  pricingRevision: number
  packages: Array<RentalPackageRecord & { currency: 'VND' }>
  disclosure: {
    version: string
    hash: string
    items: ReadonlyArray<{
      id: string
      title: string
      body: string
      required: boolean
    }>
  }
}
