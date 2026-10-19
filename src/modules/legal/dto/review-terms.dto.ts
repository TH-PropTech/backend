import {
  IsNotEmpty,
  IsNumber,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator'

/** Body của `submit-review` và `approve`. */
export class ReviewTransitionDto {
  @IsNumber()
  @Min(1)
  expectedRevision!: number
}

export class RequestChangesDto extends ReviewTransitionDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'note must not be blank' })
  @MaxLength(1000)
  note!: string
}
