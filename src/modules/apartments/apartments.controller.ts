import {
  Controller,
  Get,
  Param,
  Query,
  Patch,
  Body,
  UseGuards,
  Post,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common'
import { ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { ApartmentsService } from './apartments.service'
import {
  ApartmentResponseMapper,
  WebApartmentResponse,
  MobileApartmentResponse,
} from './mappers/apartment-response.mapper'
import { ApartmentFilterDto } from './dto/apartment-filter.dto'
import { CreateApartmentDto } from './dto/create-apartment.dto'
import { RejectApartmentDto } from './dto/reject-apartment.dto'
import { UpdateApartmentPriceDto } from './dto/update-apartment-price.dto'
import { UpdateApartmentMediaDto } from './dto/update-apartment-media.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { FilesInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { extname } from 'path'
import * as fs from 'fs'
import { ConfigService } from '@nestjs/config'
import {
  ListingQualityService,
  type QualityScoreResult,
} from './listing-quality.service'
import { QualityScoreResponseDto } from './dto/quality-score-response.dto'

import { Request } from 'express'

const uploadDir = './uploads/apartments'
const storage = diskStorage({
  destination: (
    req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, destination: string) => void
  ) => {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: (
    req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, filename: string) => void
  ) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, `${uniqueSuffix}${extname(file.originalname)}`)
  },
})

@ApiTags('apartments')
@Controller('apartments')
export class ApartmentsController {
  constructor(
    private readonly apartmentsService: ApartmentsService,
    private readonly configService: ConfigService,
    private readonly listingQualityService: ListingQualityService
  ) {}

  @Get('my-listings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  @ApiOkResponse({ type: QualityScoreResponseDto })
  async getMyListings(
    @CurrentUser('id') landlordId: string,
    @Query('format') format?: 'web' | 'mobile'
  ): Promise<WebApartmentResponse[] | MobileApartmentResponse[]> {
    const apartments = await this.apartmentsService.findByLandlord(landlordId)
    if (format === 'mobile') {
      return apartments.map(apt => ApartmentResponseMapper.toMobileJson(apt))
    }
    return apartments.map(apt => ApartmentResponseMapper.toWebJson(apt))
  }

  @Get('pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  async getPendingListings(
    @Query('format') format?: 'web' | 'mobile'
  ): Promise<WebApartmentResponse[] | MobileApartmentResponse[]> {
    const apartments = await this.apartmentsService.findPending()
    if (format === 'mobile') {
      return apartments.map(apt => ApartmentResponseMapper.toMobileJson(apt))
    }
    return apartments.map(apt => ApartmentResponseMapper.toWebJson(apt))
  }

  @Get()
  async findAll(
    @Query() query: ApartmentFilterDto & { format?: 'web' | 'mobile' }
  ): Promise<WebApartmentResponse[] | MobileApartmentResponse[]> {
    const { format, ...filters } = query
    const apartments = await this.apartmentsService.findAll(filters)
    if (format === 'web') {
      return apartments.map(apt => ApartmentResponseMapper.toWebJson(apt))
    }
    if (format === 'mobile') {
      return apartments.map(apt => ApartmentResponseMapper.toMobileJson(apt))
    }
    // Mặc định trả về định dạng Web cho tương thích tốt nhất
    return apartments.map(apt => ApartmentResponseMapper.toWebJson(apt))
  }

  /** GET /api/v1/apartments/:id/quality — Owner listing quality [uc_staff_apartment] */
  @Get(':id/quality')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  async getQualityScore(
    @Param('id') id: string,
    @CurrentUser('id') ownerId: string
  ): Promise<QualityScoreResult> {
    return this.listingQualityService.calculateQualityScore(id, ownerId)
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Query('format') format?: 'web' | 'mobile'
  ): Promise<WebApartmentResponse | MobileApartmentResponse> {
    const apartment = await this.apartmentsService.findOne(id)
    if (format === 'web') {
      return ApartmentResponseMapper.toWebJson(apartment)
    }
    if (format === 'mobile') {
      return ApartmentResponseMapper.toMobileJson(apartment)
    }
    return ApartmentResponseMapper.toWebJson(apartment)
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  async create(
    @Body() createApartmentDto: CreateApartmentDto,
    @CurrentUser('id') landlordId: string
  ): Promise<WebApartmentResponse> {
    const created = await this.apartmentsService.create(
      createApartmentDto,
      landlordId
    )
    return ApartmentResponseMapper.toWebJson(created)
  }

  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  async approve(
    @Param('id') id: string,
    @CurrentUser('id') staffId: string
  ): Promise<WebApartmentResponse> {
    const approved = await this.apartmentsService.approve(id, staffId)
    return ApartmentResponseMapper.toWebJson(approved)
  }

  @Patch(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  async reject(
    @Param('id') id: string,
    @Body() rejectApartmentDto: RejectApartmentDto
  ): Promise<WebApartmentResponse> {
    const rejected = await this.apartmentsService.reject(
      id,
      rejectApartmentDto.rejectedReason
    )
    return ApartmentResponseMapper.toWebJson(rejected)
  }

  @Patch(':id/resubmit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  async resubmit(
    @Param('id') id: string,
    @Body() createApartmentDto: CreateApartmentDto,
    @CurrentUser('id') landlordId: string
  ): Promise<WebApartmentResponse> {
    const resubmitted = await this.apartmentsService.resubmit(
      id,
      createApartmentDto,
      landlordId
    )
    return ApartmentResponseMapper.toWebJson(resubmitted)
  }

  @Patch(':id/renew')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  async renew(
    @Param('id') id: string,
    @CurrentUser('id') landlordId: string
  ): Promise<WebApartmentResponse> {
    const renewed = await this.apartmentsService.renew(id, landlordId)
    return ApartmentResponseMapper.toWebJson(renewed)
  }

  @Patch(':id/price')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  async updatePrice(
    @Param('id') id: string,
    @Body() dto: UpdateApartmentPriceDto,
    @CurrentUser('id') landlordId: string
  ): Promise<WebApartmentResponse> {
    const updated = await this.apartmentsService.updatePrice(
      id,
      dto.priceMonthly,
      landlordId
    )
    return ApartmentResponseMapper.toWebJson(updated)
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff')
  async updateStatus(
    @Param('id') id: string,
    @Body('status')
    status: 'available' | 'pending' | 'updating' | 'unavailable',
    @Body('isVerified') isVerified?: boolean
  ): Promise<WebApartmentResponse> {
    const updated = await this.apartmentsService.updateStatus(
      id,
      status,
      isVerified
    )
    return ApartmentResponseMapper.toWebJson(updated)
  }

  @Patch(':id/media')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  async updateMedia(
    @Param('id') id: string,
    @Body() dto: UpdateApartmentMediaDto
  ): Promise<WebApartmentResponse> {
    const updated = await this.apartmentsService.updateMedia(id, dto)
    return ApartmentResponseMapper.toWebJson(updated)
  }

  @Post('upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord', 'staff', 'admin')
  @UseInterceptors(
    FilesInterceptor('images', 20, {
      storage,
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
          return cb(
            new BadRequestException(
              'Chỉ cho phép tải lên file ảnh (jpg, jpeg, png, webp)!'
            ),
            false
          )
        }
        cb(null, true)
      },
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    })
  )
  uploadImages(@UploadedFiles() files: Express.Multer.File[]): {
    urls: string[]
  } {
    if (!files || files.length === 0) {
      throw new BadRequestException('Vui lòng chọn ít nhất một ảnh để tải lên!')
    }
    const appUrl =
      this.configService.get<string>('app.url') || 'http://localhost:3001'
    const urls = files.map(
      file => `${appUrl}/uploads/apartments/${file.filename}`
    )
    return { urls }
  }
}
