import { ApiProperty } from '@nestjs/swagger'
import { IsIn } from 'class-validator'
import {
  FACE_POSES,
  type FacePose,
} from '../../ekyc/interfaces/ekyc-ocr.interface'

export class FacePoseDto {
  @ApiProperty({ enum: FACE_POSES, description: 'Hướng mặt cần kiểm tra' })
  @IsIn(FACE_POSES)
  expected!: FacePose
}
