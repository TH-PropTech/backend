import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { CreateViewingNoteDto } from '../dto/create-viewing-note.dto'
import { UpdateViewingNoteDto } from '../dto/update-viewing-note.dto'
import { ViewingNoteQueryDto } from '../dto/viewing-note-query.dto'
import { ViewingNote } from '../schemas/viewing-note.schema'
import {
  ViewingNoteListResult,
  ViewingNotesService,
} from '../services/viewing-notes.service'
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator'

@ApiTags('viewing-notes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('viewing-notes')
export class ViewingNotesController {
  constructor(private readonly viewingNotesService: ViewingNotesService) {}

  /** POST /api/v1/viewing-notes [uc_customer_booking] [uc_book_viewing] */
  @Post()
  @RequirePermission('create', 'ViewingNote', ['tenant', 'landlord'])
  @ApiOperation({ summary: 'Create a private viewing note' })
  @ApiCreatedResponse({ type: ViewingNote })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateViewingNoteDto
  ): Promise<ViewingNote> {
    return this.viewingNotesService.create(userId, dto)
  }

  @Get()
  @RequirePermission('read', 'ViewingNote', ['tenant', 'landlord'])
  @ApiOperation({ summary: 'List current user viewing notes' })
  @ApiOkResponse({ description: 'Paginated private viewing notes' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: ViewingNoteQueryDto
  ): Promise<ViewingNoteListResult> {
    return this.viewingNotesService.getMyNotes(userId, query)
  }

  @Get(':id')
  @RequirePermission('read', 'ViewingNote', ['tenant', 'landlord'])
  @ApiOperation({ summary: 'Get a private viewing note' })
  @ApiOkResponse({ type: ViewingNote })
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string
  ): Promise<ViewingNote> {
    return this.viewingNotesService.getById(id, userId)
  }

  @Patch(':id')
  @RequirePermission('update', 'ViewingNote', ['tenant', 'landlord'])
  @ApiOperation({ summary: 'Update a private viewing note' })
  @ApiOkResponse({ type: ViewingNote })
  async update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateViewingNoteDto
  ): Promise<ViewingNote> {
    return this.viewingNotesService.update(id, userId, dto)
  }

  @Delete(':id')
  @RequirePermission('delete', 'ViewingNote', ['tenant', 'landlord'])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a private viewing note' })
  @ApiNoContentResponse()
  async remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string
  ): Promise<void> {
    return this.viewingNotesService.delete(id, userId)
  }
}
