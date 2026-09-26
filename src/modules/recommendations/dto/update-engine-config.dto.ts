import {
  IsEnum,
  IsNumber,
  Min,
  Max,
  ValidateIf,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { EngineStrategy } from '../entities/recommendation-config.entity'

/**
 * Custom validator: ensures nbWeight + ruleWeight === 1.0 (within float tolerance).
 */
function WeightsSumToOne(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'weightsSumToOne',
      target: (object as { constructor: new (...args: unknown[]) => unknown })
        .constructor,
      propertyName,
      options: validationOptions ?? {},
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const dto = args.object as UpdateEngineConfigDto
          const sum =
            typeof dto.nbWeight === 'number' &&
            typeof dto.ruleWeight === 'number'
              ? dto.nbWeight + dto.ruleWeight
              : NaN
          return Math.abs(sum - 1.0) < 1e-9
        },
        defaultMessage() {
          return 'nbWeight + ruleWeight must equal 1.0'
        },
      },
    })
  }
}

export class UpdateEngineConfigDto {
  @ApiProperty({
    description: 'Chiến lược gợi ý',
    enum: ['hybrid', 'map', 'weighted', 'map-weighted'],
    example: 'hybrid',
  })
  @IsEnum(['hybrid', 'map', 'weighted', 'map-weighted'] as const, {
    message: 'strategy must be one of: hybrid, map, weighted, map-weighted',
  })
  strategy!: EngineStrategy

  @ApiProperty({
    description:
      'Dirichlet prior alpha cho MAP Bayesian smoothing (min 0.1, tương đương Laplace khi = 1.0)',
    example: 1.0,
    minimum: 0.1,
  })
  @IsNumber()
  @Min(0.1)
  alpha!: number

  @ApiProperty({
    description: 'Trọng số Naive Bayes (0–1). nbWeight + ruleWeight phải = 1.0',
    example: 0.5,
    minimum: 0,
    maximum: 1,
  })
  @IsNumber()
  @Min(0)
  @Max(1)
  @WeightsSumToOne({ message: 'nbWeight + ruleWeight must equal 1.0' })
  nbWeight!: number

  @ApiProperty({
    description: 'Trọng số rule-based (0–1). nbWeight + ruleWeight phải = 1.0',
    example: 0.5,
    minimum: 0,
    maximum: 1,
  })
  @IsNumber()
  @Min(0)
  @Max(1)
  @ValidateIf(() => true)
  ruleWeight!: number
}
