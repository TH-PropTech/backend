import { OmitType, PartialType } from '@nestjs/swagger'
import { CreateViewingNoteDto } from './create-viewing-note.dto'

export class UpdateViewingNoteDto extends PartialType(
  OmitType(CreateViewingNoteDto, ['apartmentId', 'bookingId'] as const)
) {}
