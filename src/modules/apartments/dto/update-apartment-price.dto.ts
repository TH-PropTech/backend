import { IsNumber, Min } from 'class-validator'

export class UpdateApartmentPriceDto {
  @IsNumber()
  @Min(1)
  priceMonthly!: number
}
