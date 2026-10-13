import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import type { Response } from 'express'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { AnalyzeConditionDto } from '../dto/analyze-condition.dto'
import { AnalysisResponseDto } from '../dto/analysis-response.dto'
import { ConditionAnalysisQueryDto } from '../dto/condition-analysis-query.dto'
import { ConditionAnalysisService } from '../services/condition-analysis.service'
import { ConditionAnalysis } from '../schemas/condition-analysis.schema'

const CONDITION_UPLOAD_DIRECTORY = './private-uploads/condition-analysis'
const CONDITION_IMAGE_MAX_BYTES = 4 * 1024 * 1024
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

const conditionImageStorage = diskStorage({
  destination: (_request, _file, callback) => {
    fs.mkdirSync(CONDITION_UPLOAD_DIRECTORY, { recursive: true })
    callback(null, CONDITION_UPLOAD_DIRECTORY)
  },
  filename: (_request, file, callback) => {
    const extension = IMAGE_EXTENSIONS[file.mimetype]
    if (!extension) {
      callback(
        new BadRequestException('Only JPEG, PNG and WebP are allowed'),
        ''
      )
      return
    }
    callback(null, `${randomUUID()}${extension}`)
  },
})

@ApiTags('condition-analysis')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('condition-analyses')
export class ConditionAnalysisController {
  private readonly logger = new Logger(ConditionAnalysisController.name)

  constructor(
    private readonly conditionAnalysisService: ConditionAnalysisService
  ) {}

  /** Analyze a property image while keeping the resulting record private. [uc_customer_apartment] */
  @Post()
  @UseInterceptors(
    FileInterceptor('image', {
      storage: conditionImageStorage,
      limits: { fileSize: CONDITION_IMAGE_MAX_BYTES, files: 1 },
      fileFilter: (_request, file, callback) => {
        if (!IMAGE_EXTENSIONS[file.mimetype]) {
          callback(
            new BadRequestException('Only JPEG, PNG and WebP are allowed'),
            false
          )
          return
        }
        callback(null, true)
      },
    })
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Analyze one uploaded property image' })
  @ApiCreatedResponse({ type: AnalysisResponseDto })
  async analyze(
    @CurrentUser('id') userId: string,
    @Body() dto: AnalyzeConditionDto,
    @UploadedFile() file?: Express.Multer.File
  ): Promise<ConditionAnalysis> {
    if (!file) {
      throw new BadRequestException('Image is required')
    }

    try {
      return await this.conditionAnalysisService.analyze(userId, {
        apartmentId: dto.apartmentId,
        imageStorageKey: file.filename,
        image: await fs.promises.readFile(file.path),
        mimeType: file.mimetype,
      })
    } catch (error) {
      try {
        await fs.promises.unlink(path.resolve(file.path))
      } catch (cleanupError) {
        this.logger.warn(
          `Could not remove failed condition upload: ${String(cleanupError)}`
        )
      }
      throw error
    }
  }

  @Get()
  @ApiOperation({ summary: 'List current user condition analyses' })
  @ApiOkResponse({ type: AnalysisResponseDto, isArray: true })
  async listMine(
    @CurrentUser('id') userId: string,
    @Query() query: ConditionAnalysisQueryDto
  ): Promise<ConditionAnalysis[]> {
    return this.conditionAnalysisService.listMine(userId, query.apartmentId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a private condition analysis' })
  @ApiOkResponse({ type: AnalysisResponseDto })
  async getMine(
    @Param('id') id: string,
    @CurrentUser('id') userId: string
  ): Promise<ConditionAnalysis> {
    return this.conditionAnalysisService.getMine(id, userId)
  }

  @Get(':id/image')
  @ApiOperation({ summary: 'Read the private source image for an analysis' })
  async getImage(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Res() response: Response
  ): Promise<void> {
    const analysis = await this.conditionAnalysisService.getMine(id, userId)
    await new Promise<void>((resolve, reject) => {
      response.sendFile(
        path.resolve(
          CONDITION_UPLOAD_DIRECTORY,
          path.basename(analysis.imageStorageKey)
        ),
        error => {
          if (error) reject(error)
          else resolve()
        }
      )
    })
  }
}
