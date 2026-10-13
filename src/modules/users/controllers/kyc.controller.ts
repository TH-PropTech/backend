import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  Query,
  UseGuards,
  Post,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  Res,
} from '@nestjs/common'
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger'
import {
  FileInterceptor,
  FileFieldsInterceptor,
} from '@nestjs/platform-express'
import { GroqCccdOcrService } from '../../ekyc/services/groq-cccd-ocr.service'
import {
  KycService,
  KycListResult,
  KycSelfResult,
} from '../services/kyc.service'
import {
  EkycProxyService,
  EkycBiometricResult,
  EkycFaceMatchResult,
  EkycFaceOrientationResult,
  EkycOcrBackResult,
  EkycOcrFrontResult,
} from '../../ekyc/services/ekyc-proxy.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { Roles } from '../../../common/decorators/roles.decorator'
import { KycQueryDto } from '../dto/kyc-query.dto'
import { ReviewKycDto } from '../dto/review-kyc.dto'
import { SubmitKycDto } from '../dto/submit-kyc.dto'
import { KycRecord } from '../schemas/kyc-record.schema'
import { CurrentUser } from '../../../common/decorators/current-user.decorator'
import type { Response } from 'express'
import { BiometricGrantService } from '../../ekyc/services/biometric-grant.service'
import { KYC_IMAGE_MAX_BYTES, validateKycImage } from '../utils/kyc-image.util'

@ApiTags('kyc')
@ApiBearerAuth()
@Controller('kyc')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KycController {
  constructor(
    private readonly kycService: KycService,
    private readonly ekycProxyService: EkycProxyService,
    private readonly biometricGrantService: BiometricGrantService,
    private readonly groqCccdOcr: GroqCccdOcrService
  ) {}

  /**
   * POST /api/v1/kyc/ocr-front
   * Nhận ảnh mặt trước CCCD từ client, đọc thông tin in trên thẻ bằng Groq vision
   */
  @Post('ocr-front')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('frontID', { limits: { fileSize: KYC_IMAGE_MAX_BYTES } })
  )
  async ocrFront(
    @UploadedFile() file?: Express.Multer.File
  ): Promise<EkycOcrFrontResult> {
    if (!file) throw new BadRequestException('Thiếu file frontID')
    validateKycImage(file)
    return this.groqCccdOcr.ocrFront(file)
  }

  /**
   * POST /api/v1/kyc/ocr-back
   * Nhận ảnh mặt sau CCCD từ client, đọc thông tin in trên thẻ bằng Groq vision
   */
  @Post('ocr-back')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('backID', { limits: { fileSize: KYC_IMAGE_MAX_BYTES } })
  )
  async ocrBack(
    @UploadedFile() file?: Express.Multer.File
  ): Promise<EkycOcrBackResult> {
    if (!file) throw new BadRequestException('Thiếu file backID')
    validateKycImage(file)
    return this.groqCccdOcr.ocrBack(file)
  }

  @Post('face-orientation')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('frame', { limits: { fileSize: KYC_IMAGE_MAX_BYTES } })
  )
  async faceOrientation(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('expected') expected?: string
  ): Promise<EkycFaceOrientationResult> {
    if (!file) throw new BadRequestException('Thiếu file frame')
    if (!expected || !['center', 'left', 'right'].includes(expected)) {
      throw new BadRequestException('Tham số expected không hợp lệ')
    }
    validateKycImage(file)
    return this.ekycProxyService.detectOrientation(file, expected)
  }

  @Post('face-match')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'portraitImages', maxCount: 7 },
        { name: 'frontID', maxCount: 1 },
      ],
      { limits: { fileSize: KYC_IMAGE_MAX_BYTES, files: 8 } }
    )
  )
  async faceMatch(
    @UploadedFiles()
    files: {
      portraitImages?: Express.Multer.File[]
      frontID?: Express.Multer.File[]
    }
  ): Promise<EkycFaceMatchResult> {
    const portraits = files?.portraitImages ?? []
    const frontCard = files?.frontID?.[0]
    if (portraits.length < 1)
      throw new BadRequestException('Thiếu file portraitImages')
    if (portraits.length > 7)
      throw new BadRequestException('Tối đa 7 ảnh portraitImages')
    if (!frontCard) throw new BadRequestException('Thiếu file frontID')
    portraits.forEach(validateKycImage)
    validateKycImage(frontCard)
    return this.ekycProxyService.verifyFaceMatch(portraits, frontCard)
  }

  /**
   * POST /api/v1/kyc/verify-face
   * Nhận ảnh selfie + mặt trước CCCD, proxy sang eKYC Python Liveness + Face Matching
   */
  @Post('verify-face')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'portraitImages', maxCount: 1 },
        { name: 'frontID', maxCount: 1 },
      ],
      { limits: { fileSize: KYC_IMAGE_MAX_BYTES, files: 2 } }
    )
  )
  async verifyFace(
    @CurrentUser('id') userId: string,
    @UploadedFiles()
    files: {
      portraitImages?: Express.Multer.File[]
      frontID?: Express.Multer.File[]
    }
  ): Promise<EkycBiometricResult> {
    const selfie = files.portraitImages?.[0]
    const portraits = selfie ? [selfie] : []
    const frontCard = files.frontID?.[0]
    if (!selfie)
      throw new BadRequestException('Thiếu file selfie (portraitImages)')
    if (!frontCard) throw new BadRequestException('Thiếu file frontID')
    if (portraits.length > 7)
      throw new BadRequestException('Tối đa 7 ảnh selfie (portraitImages)')
    portraits.forEach(validateKycImage)
    validateKycImage(frontCard)
    const result = await this.ekycProxyService.verifyFace(selfie, frontCard)
    this.biometricGrantService.issue(userId, result)
    return result
  }

  /**
   * POST /api/v1/kyc/submit
   * Người dùng nộp hồ sơ KYC (lưu DB)
   */
  @Post('submit')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'frontCard', maxCount: 1 },
        { name: 'backCard', maxCount: 1 },
        { name: 'selfie', maxCount: 1 },
      ],
      { limits: { fileSize: KYC_IMAGE_MAX_BYTES, files: 3 } }
    )
  )
  async submitKyc(
    @Body() dto: SubmitKycDto,
    @UploadedFiles()
    files: {
      frontCard?: Express.Multer.File[]
      backCard?: Express.Multer.File[]
      selfie?: Express.Multer.File[]
    },
    @CurrentUser('id') userId: string
  ): Promise<KycRecord> {
    if (!userId) throw new BadRequestException('Không thể xác thực người dùng')
    const frontCard = requireImage(files.frontCard?.[0], 'frontCard')
    const backCard = requireImage(files.backCard?.[0], 'backCard')
    const selfie = requireImage(files.selfie?.[0], 'selfie')
    return this.kycService.submitKyc(userId, dto, {
      frontCard,
      backCard,
      selfie,
    })
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

  @Get('me')
  async findMine(
    @CurrentUser('id') userId: string
  ): Promise<KycSelfResult | null> {
    return this.kycService.findMine(userId)
  }

  @Get(':id/media/:field')
  async getMedia(
    @Param('id') id: string,
    @Param('field') rawField: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('roles') roles: string[] | undefined,
    @Res() response: Response
  ): Promise<void> {
    const field = parseMediaField(rawField)
    const media = await this.kycService.readMedia(id, field, userId, roles)
    response.setHeader('Content-Type', media.mimetype)
    response.setHeader('Cache-Control', 'private, no-store')
    response.send(media.buffer)
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
    @CurrentUser('id') reviewedBy: string
  ): Promise<KycRecord> {
    if (!reviewedBy)
      throw new BadRequestException('Không thể xác thực người dùng')

    return this.kycService.review(
      id,
      dto.status,
      reviewedBy,
      dto.rejectedReason
    )
  }
}

function requireImage(
  file: Express.Multer.File | undefined,
  fieldName: string
): Express.Multer.File {
  if (!file) throw new BadRequestException(`Thiếu file ${fieldName}`)
  validateKycImage(file)
  return file
}

function parseMediaField(field: string): 'front-card' | 'back-card' | 'selfie' {
  if (field === 'front-card' || field === 'back-card' || field === 'selfie') {
    return field
  }
  throw new BadRequestException('Loại ảnh KYC không hợp lệ')
}
