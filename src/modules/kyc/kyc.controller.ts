import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  Query,
  UseGuards,
  Request,
  Post,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import {
  FileInterceptor,
  FileFieldsInterceptor,
} from '@nestjs/platform-express'
import { KycService, KycListResult } from './kyc.service'
import {
  EkycProxyService,
  EkycOcrFrontResponse,
  EkycOcrBackResponse,
  EkycVerificationResponse,
} from './ekyc-proxy.service'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { Roles } from '../../common/decorators/roles.decorator'
import { KycQueryDto } from './dto/kyc-query.dto'
import { ReviewKycDto } from './dto/review-kyc.dto'
import { SubmitKycDto } from './dto/submit-kyc.dto'
import { UserPayload } from '../auth/interfaces/auth.interface'
import { KycRecord } from './schemas/kyc-record.schema'

@ApiTags('kyc')
@Controller('kyc')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KycController {
  constructor(
    private readonly kycService: KycService,
    private readonly ekycProxyService: EkycProxyService
  ) {}

  /**
   * POST /api/v1/kyc/ocr-front
   * Nhận ảnh mặt trước CCCD từ client, proxy sang eKYC Python OCR, trả về kết quả
   */
  @Post('ocr-front')
  @UseInterceptors(FileInterceptor('frontID'))
  async ocrFront(
    @UploadedFile() file: Express.Multer.File
  ): Promise<EkycOcrFrontResponse> {
    if (!file) throw new BadRequestException('Thiếu file frontID')
    return this.ekycProxyService.ocrFront(file)
  }

  /**
   * POST /api/v1/kyc/ocr-back
   * Nhận ảnh mặt sau CCCD từ client, proxy sang eKYC Python OCR, trả về kết quả
   */
  @Post('ocr-back')
  @UseInterceptors(FileInterceptor('backID'))
  async ocrBack(
    @UploadedFile() file: Express.Multer.File
  ): Promise<EkycOcrBackResponse> {
    if (!file) throw new BadRequestException('Thiếu file backID')
    return this.ekycProxyService.ocrBack(file)
  }

  /**
   * POST /api/v1/kyc/verify-face
   * Nhận ảnh selfie + mặt trước CCCD, proxy sang eKYC Python Liveness + Face Matching
   */
  @Post('verify-face')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'portraitImages', maxCount: 1 },
      { name: 'frontID', maxCount: 1 },
    ])
  )
  async verifyFace(
    @UploadedFiles()
    files: {
      portraitImages?: Express.Multer.File[]
      frontID?: Express.Multer.File[]
    }
  ): Promise<EkycVerificationResponse> {
    const selfie = files.portraitImages?.[0]
    const frontCard = files.frontID?.[0]
    if (!selfie)
      throw new BadRequestException('Thiếu file selfie (portraitImages)')
    if (!frontCard) throw new BadRequestException('Thiếu file frontID')

    return this.ekycProxyService.verifyFace(selfie, frontCard)
  }

  /**
   * POST /api/v1/kyc/submit
   * Người dùng nộp hồ sơ KYC (lưu DB)
   */
  @Post('submit')
  async submitKyc(
    @Body() dto: SubmitKycDto,
    @Request() req: { user: UserPayload }
  ): Promise<KycRecord> {
    const userId = req.user._id
    if (!userId) throw new BadRequestException('Không thể xác thực người dùng')
    return this.kycService.submitKyc(userId, dto)
  }

  /**
   * GET /api/v1/kyc
   * Staff/Admin: Lấy danh sách hồ sơ KYC (hỗ trợ lọc, tìm kiếm, phân trang)
   */
  @Get()
  @Roles('staff', 'admin')
  async findAll(@Query() query: KycQueryDto): Promise<KycListResult> {
    return this.kycService.findAll({
      status: query.status,
      search: query.search,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    })
  }

  /**
   * GET /api/v1/kyc/stats
   * Staff/Admin: Đếm hồ sơ KYC theo trạng thái (dashboard metrics)
   */
  @Get('stats')
  @Roles('staff', 'admin')
  async getStats(): Promise<
    Record<'pending' | 'verified' | 'rejected' | 'total', number>
  > {
    return this.kycService.countByStatus()
  }

  /**
   * GET /api/v1/kyc/:id
   * Staff/Admin: Xem chi tiết 1 hồ sơ KYC
   */
  @Get(':id')
  @Roles('staff', 'admin')
  async findOne(@Param('id') id: string): Promise<KycRecord> {
    return this.kycService.findOne(id)
  }

  /**
   * PATCH /api/v1/kyc/:id/review
   * Staff/Admin: Duyệt hoặc từ chối hồ sơ KYC
   */
  @Patch(':id/review')
  @Roles('staff', 'admin')
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewKycDto,
    @Request() req: { user: UserPayload }
  ): Promise<KycRecord> {
    const reviewedBy = req.user._id
    if (!reviewedBy) throw new Error('Không thể xác thực người dùng')

    return this.kycService.review(
      id,
      dto.status,
      reviewedBy,
      dto.rejectedReason
    )
  }
}
