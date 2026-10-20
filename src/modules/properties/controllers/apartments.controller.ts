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
import { ApartmentsService } from '../services/apartments.service'
import {
  ApartmentResponseMapper,
  WebApartmentResponse,
  MobileApartmentResponse,
  LandlordApartmentResponse,
  StaffApartmentResponse,
} from '../mappers/apartment-response.mapper'
import { ApartmentFilterDto } from '../dto/apartment-filter.dto'
import {
  CreateApartmentDto,
  UpdateRentalPackagesDto,
} from '../dto/create-apartment.dto'
import { RejectApartmentDto } from '../dto/reject-apartment.dto'
import { UpdateApartmentPriceDto } from '../dto/update-apartment-price.dto'
import { UpdateApartmentMediaDto } from '../dto/update-apartment-media.dto'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import { FilesInterceptor } from '@nestjs/platform-express'
import {
  ListingQualityService,
  type QualityScoreResult,
} from '../services/listing-quality.service'
import { QualityScoreResponseDto } from '../dto/quality-score-response.dto'
import { UpdateApartmentDto } from '../dto/update-apartment.dto'
import { ApartmentMediaUploadService } from '../services/apartment-media-upload.service'
import {
  APARTMENT_IMAGE_MAX_BYTES,
  APARTMENT_IMAGE_MAX_COUNT,
  apartmentImageFilter,
} from '../utils/apartment-upload.options'
import { Public } from '../../../common/decorators/public.decorator'
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator'

function isStaffOrAdmin(user: UserPayload): boolean {
  return user.roles?.some(role => ['staff', 'admin'].includes(role)) ?? false
}

@ApiTags('apartments')
@Controller('apartments')
export class ApartmentsController {
  constructor(
    private readonly apartmentsService: ApartmentsService,
    private readonly listingQualityService: ListingQualityService,
    private readonly mediaUploadService: ApartmentMediaUploadService
  ) {}

  @Get('my-listings')
  @RequirePermission('read', 'Apartment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  @ApiOkResponse({ type: QualityScoreResponseDto })
  async getMyListings(
    @CurrentUser('id') landlordId: string,
    @Query('format') format?: 'web' | 'mobile' | 'landlord'
  ): Promise<
    | WebApartmentResponse[]
    | MobileApartmentResponse[]
    | LandlordApartmentResponse[]
  > {
    const apartments = await this.apartmentsService.findByLandlord(landlordId)
    if (format === 'landlord') {
      return apartments.map(apt => ApartmentResponseMapper.toLandlordJson(apt))
    }
    if (format === 'mobile') {
      return apartments.map(apt => ApartmentResponseMapper.toMobileJson(apt))
    }
    return apartments.map(apt => ApartmentResponseMapper.toWebJson(apt))
  }

  @Get('pending')
  @RequirePermission('read', 'Apartment')
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

  @Get('manage')
  @RequirePermission('read', 'Apartment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  async getManageListings(): Promise<StaffApartmentResponse[]> {
    const apartments = await this.apartmentsService.findAllForStaff()
    return apartments.map(apt => ApartmentResponseMapper.toStaffJson(apt))
  }

  @Get('rejected')
  @RequirePermission('read', 'Apartment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  async getRejectedListings(
    @Query('format') format?: 'web' | 'mobile'
  ): Promise<WebApartmentResponse[] | MobileApartmentResponse[]> {
    const apartments = await this.apartmentsService.findRejected()
    if (format === 'mobile') {
      return apartments.map(apt => ApartmentResponseMapper.toMobileJson(apt))
    }
    return apartments.map(apt => ApartmentResponseMapper.toWebJson(apt))
  }

  @Public()
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
  @RequirePermission('read', 'Apartment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord')
  async getQualityScore(
    @Param('id') id: string,
    @CurrentUser('id') ownerId: string
  ): Promise<QualityScoreResult> {
    return this.listingQualityService.calculateQualityScore(id, ownerId)
  }

  @Public()
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
  @RequirePermission('create', 'Apartment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord', 'staff', 'admin')
  async create(
    @Body() createApartmentDto: CreateApartmentDto,
    @CurrentUser('id') posterId: string
  ): Promise<WebApartmentResponse> {
    const created = await this.apartmentsService.create(
      createApartmentDto,
      posterId
    )
    return ApartmentResponseMapper.toWebJson(created)
  }

  @Patch(':id')
  @RequirePermission('update', 'Apartment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord', 'staff', 'admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateApartmentDto,
    @CurrentUser('id') userId: string,
    @CurrentUser() user: UserPayload
  ): Promise<StaffApartmentResponse> {
    const updated = await this.apartmentsService.update(
      id,
      dto,
      userId,
      isStaffOrAdmin(user)
    )
    return ApartmentResponseMapper.toStaffJson(updated)
  }

  @Patch(':id/approve')
  @RequirePermission('approve', 'Apartment')
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
  @RequirePermission('approve', 'Apartment')
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
  @RequirePermission('update', 'Apartment')
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
  @RequirePermission('update', 'Apartment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord', 'staff', 'admin')
  async renew(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser() user: UserPayload
  ): Promise<WebApartmentResponse> {
    const renewed = await this.apartmentsService.renew(
      id,
      userId,
      isStaffOrAdmin(user)
    )
    return ApartmentResponseMapper.toWebJson(renewed)
  }

  @Patch(':id/price')
  @RequirePermission('update', 'Apartment')
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

  @Patch(':id/packages')
  @RequirePermission('update', 'Apartment')
  @Post(':id/rental-packages')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord', 'staff', 'admin')
  async updateRentalPackages(
    @Param('id') id: string,
    @Body() dto: UpdateRentalPackagesDto,
    @CurrentUser() user: UserPayload
  ): Promise<WebApartmentResponse> {
    const updated = await this.apartmentsService.updateRentalPackages(
      id,
      dto,
      user._id ?? '',
      isStaffOrAdmin(user)
    )
    return ApartmentResponseMapper.toWebJson(updated)
  }

  @Patch(':id/status')
  @RequirePermission('update', 'Apartment')
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
  @RequirePermission('update', 'Apartment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('staff', 'admin')
  async updateMedia(
    @Param('id') id: string,
    @Body() dto: UpdateApartmentMediaDto
  ): Promise<StaffApartmentResponse> {
    const updated = await this.apartmentsService.updateMedia(id, dto)
    return ApartmentResponseMapper.toStaffJson(updated)
  }

  @Post('upload')
  @RequirePermission('create', 'Apartment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('landlord', 'staff', 'admin')
  @UseInterceptors(
    FilesInterceptor('images', APARTMENT_IMAGE_MAX_COUNT, {
      fileFilter: apartmentImageFilter,
      limits: { fileSize: APARTMENT_IMAGE_MAX_BYTES },
    })
  )
  async uploadImages(
    @UploadedFiles() files: Express.Multer.File[]
  ): Promise<{ urls: string[] }> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Vui lòng chọn ít nhất một ảnh để tải lên!')
    }
    const urls = await this.mediaUploadService.uploadImages(files)
    return { urls }
  }
}
