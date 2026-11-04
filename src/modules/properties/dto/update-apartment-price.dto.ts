import { IsNumber, Max, Min } from 'class-validator'
import { MAX_MONTHLY_RENT_VND } from '../utils/rental-package.util'

export class UpdateApartmentPriceDto {
  @IsNumber()
  @Min(1)
  @Max(MAX_MONTHLY_RENT_VND)
  priceMonthly!: number
}
