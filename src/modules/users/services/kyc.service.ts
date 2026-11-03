import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { MongoRepository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { KycRecord } from '../schemas/kyc-record.schema'
import { User, type KycInfo } from '../schemas/user.schema'
import { SubmitKycDto } from '../dto/submit-kyc.dto'
import {
  KycMediaContent,
  KycMediaKind,
  KycMediaService,
} from './kyc-media.service'
import { EkycClient } from '../../ekyc/services/ekyc-client.service'
import type { EkycFaceResult } from '../../ekyc/interfaces/ekyc-ocr.interface'

/**
 * Hồ sơ KYC nhúng trong `users.kyc` (G-KYC, migration 026). `KycRecord` vẫn là
 * hình JSON trả về; `_id` là `kyc.recordId` (id công khai `/kyc/:id`).
 * Mọi đọc đi qua truy vấn thô (aggregate) vì `User` bỏ `kyc` khi nạp entity.
 */
export interface KycListItem extends Omit<
  KycRecord,
  'frontCardUrl' | 'backCardUrl' | 'selfieUrl'
> {
  user?: { email: string; phone: string } | null
}

export interface KycListResult {
  items: KycListItem[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface KycSelfResult {
  id: string
  status: 'pending' | 'verified' | 'rejected'
  rejectedReason: string | null
  fullName?: string
  idCardNumber: string
  dateOfBirth?: string
  gender?: string
  nationality?: string
  placeOfOrigin?: string
  placeOfResidence?: string
  issueDate?: string
  placeOfIssue?: string
  faceMatchResult?: boolean
  livenessResult?: boolean
  realConfidence?: number
  createdAt: Date
  updatedAt: Date
}

export interface KycSubmissionFiles {
  frontCard: Express.Multer.File
  backCard: Express.Multer.File
  selfie: Express.Multer.File
}

export type KycMediaField = 'front-card' | 'back-card' | 'selfie'

/** Hàng `users` thô có `kyc` (đã lọc `kyc` là object). */
type UserKycRow = {
  _id: ObjectId
  email?: string
  phone?: string
  kycStatus?: string
  kyc: KycInfo
}

const IMAGE_FIELDS = ['frontCardUrl', 'backCardUrl', 'selfieUrl'] as const

const OPTIONAL_DTO_FIELDS = [
  'fullName',
  'dateOfBirth',
  'gender',
  'nationality',
  'placeOfOrigin',
  'placeOfResidence',
  'issueDate',
  'placeOfIssue',
] as const

const STATUSES = ['pending', 'verified', 'rejected'] as const

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name)

  constructor(
    @InjectRepository(User)
    private readonly userRepository: MongoRepository<User>,
    private readonly kycMediaService: KycMediaService,
    private readonly ekycClient: EkycClient
  ) {}

  /**
   * Lấy danh sách hồ sơ KYC — Staff giám sát (hàng đợi duyệt).
   * Quét `users` có `kyc`, lọc status/tìm kiếm, sắp xếp theo `kyc.createdAt`, phân trang
   * ngay trong truy vấn. Không trả URL ảnh (lấy qua `/kyc/:id/media/:field`).
   */
  async findAll(query: {
    status?: string | undefined
    search?: string | undefined
    page: number
    limit: number
  }): Promise<KycListResult> {
    this.logger.log(
      `Fetching KYC records: status=${query.status ?? 'all'}, search=${query.search ?? ''}, page=${query.page}`
    )

    const match: Record<string, unknown> = { kyc: { $type: 'object' } }
    if (query.status) {
      match['kyc.status'] = query.status
    }
    if (query.search) {
      // Khớp chuỗi (không regex người dùng): tên không phân biệt hoa thường, CCCD đúng như cũ
      const pattern = escapeRegex(query.search)
      match.$or = [
        { 'kyc.fullName': { $regex: pattern, $options: 'i' } },
        { 'kyc.idCardNumber': { $regex: pattern } },
      ]
    }

    const page = query.page
    const limit = query.limit
    if (!(limit >= 1)) {
      const counted = (await this.userRepository
        .aggregate([{ $match: match }, { $count: 'n' }])
        .toArray()) as Array<{ n: number }>
      const total = counted[0]?.n ?? 0
      return {
        items: [],
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
    }

    const skip = Math.max(0, (page - 1) * limit)
    const [facet] = (await this.userRepository
      .aggregate([
        { $match: match },
        { $sort: { 'kyc.createdAt': -1, _id: -1 } },
        {
          $facet: {
            items: [
              { $skip: skip },
              { $limit: limit },
              { $project: { email: 1, phone: 1, kyc: 1 } },
            ],
            total: [{ $count: 'n' }],
          },
        },
      ])
      .toArray()) as Array<{
      items: UserKycRow[]
      total: Array<{ n: number }>
    }>

    const total = facet?.total[0]?.n ?? 0
    return {
      items: (facet?.items ?? []).map(toListItem),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
   * Lấy chi tiết 1 hồ sơ KYC theo ID công khai (`kyc.recordId`).
   */
  async findOne(
    id: string
  ): Promise<KycRecord & { user?: { email: string; phone: string } | null }> {
    this.logger.log(`Fetching KYC record: ${id}`)
    try {
      const row = await this.findKycRowByRecordId(new ObjectId(id))
      if (!row) {
        throw new NotFoundException(`Không tìm thấy hồ sơ KYC: ${id}`)
      }
      return {
        ...toKycRecord(row),
        user: {
          email: row.email as string,
          phone: row.phone as string,
        },
      }
    } catch (error) {
      if (error instanceof NotFoundException) throw error
      throw new NotFoundException(`ID KYC không hợp lệ: ${id}`)
    }
  }

  /**
   * Lấy hồ sơ KYC của một người dùng theo userId.
   */
  async findByUserId(userId: string): Promise<KycRecord | null> {
    if (!ObjectId.isValid(userId)) return null
    const row = await this.findKycRowByUser(new ObjectId(userId))
    return row ? toKycRecord(row) : null
  }

  async findMine(userId: string): Promise<KycSelfResult | null> {
    const record = await this.findByUserId(userId)
    return record ? toSelfResult(record) : null
  }

  async readMedia(
    id: string,
    field: KycMediaField,
    requesterId: string,
    requesterRoles: string[] = []
  ): Promise<KycMediaContent> {
    if (!ObjectId.isValid(id)) {
      throw new BadRequestException('ID KYC không hợp lệ')
    }
    const row = await this.findKycRowByRecordId(new ObjectId(id))
    if (!row) {
      throw new NotFoundException(`Không tìm thấy hồ sơ KYC: ${id}`)
    }

    const canReview = requesterRoles.some(role =>
      ['staff', 'admin'].includes(role)
    )
    if (row._id.toHexString() !== requesterId && !canReview) {
      throw new ForbiddenException('Bạn không có quyền xem ảnh KYC này')
    }

    const references: Record<KycMediaField, string> = {
      'front-card': row.kyc.frontCardUrl,
      'back-card': row.kyc.backCardUrl,
      selfie: row.kyc.selfieUrl,
    }
    const reference = references[field]
    // Hồ sơ nộp trước khi có bước selfie không có ảnh này.
    if (!reference) {
      throw new NotFoundException('Hồ sơ KYC không có ảnh này')
    }
    return this.kycMediaService.read(reference)
  }

  /**
   * Staff duyệt hoặc từ chối hồ sơ KYC.
   * Một `updateOne` nguyên tử cập nhật `kyc.*` và `User.kycStatus` cùng lúc.
   */
  async review(
    id: string,
    status: 'verified' | 'rejected',
    reviewedBy: string,
    rejectedReason?: string
  ): Promise<KycRecord & { user?: { email: string; phone: string } | null }> {
    this.logger.log(`Reviewing KYC ${id}: ${status} by ${reviewedBy}`)

    if (status === 'rejected' && !rejectedReason) {
      throw new BadRequestException(
        'Vui lòng nhập lý do từ chối khi reject hồ sơ KYC'
      )
    }

    const recordId = new ObjectId(id)
    const row = await this.findKycRowByRecordId(recordId)
    if (!row) {
      throw new NotFoundException(`Không tìm thấy hồ sơ KYC: ${id}`)
    }

    if (row.kyc.status !== 'pending') {
      throw new BadRequestException(
        `Hồ sơ KYC đã ở trạng thái "${row.kyc.status}", không thể duyệt lại`
      )
    }

    const now = new Date()
    const verified = status === 'verified'
    const reason = verified ? null : (rejectedReason ?? null)
    const result = await this.userRepository.updateOne(
      {
        _id: row._id,
        'kyc.recordId': recordId,
        'kyc.status': 'pending',
      },
      {
        $set: {
          'kyc.status': status,
          'kyc.reviewedBy': reviewedBy,
          'kyc.verifiedAt': verified ? now : null,
          'kyc.rejectedReason': reason,
          'kyc.updatedAt': now,
          kycStatus: status,
          kycRejectReason: reason,
          updatedAt: now,
        },
      }
    )
    if (!isMatched(result)) {
      // Không còn `pending` (staff khác đã duyệt/từ chối đồng thời) hoặc hồ sơ đã mất.
      const current = await this.findKycRowByRecordId(recordId)
      if (!current) {
        throw new NotFoundException(`Không tìm thấy hồ sơ KYC: ${id}`)
      }
      throw new BadRequestException(
        `Hồ sơ KYC đã ở trạng thái "${current.kyc.status}", không thể duyệt lại`
      )
    }

    return this.findOne(id)
  }

  /**
   * Đếm số hồ sơ KYC theo trạng thái — dùng cho dashboard metrics.
   */
  async countByStatus(): Promise<
    Record<'pending' | 'verified' | 'rejected' | 'total', number>
  > {
    const rows = (await this.userRepository
      .aggregate([
        { $match: { kyc: { $type: 'object' } } },
        { $group: { _id: '$kyc.status', count: { $sum: 1 } } },
      ])
      .toArray()) as Array<{ _id: unknown; count: number }>

    const counts = { pending: 0, verified: 0, rejected: 0, total: 0 }
    for (const row of rows) {
      counts.total += row.count
      const status = String(row._id)
      if ((STATUSES as readonly string[]).includes(status)) {
        counts[status as (typeof STATUSES)[number]] += row.count
      }
    }
    return counts
  }

  /**
   * Người dùng nộp hồ sơ KYC.
   * Tạo mới hoặc cập nhật hồ sơ cũ nếu đã có (giữ `recordId`, `createdAt`).
   */
  async submitKyc(
    userId: string,
    dto: SubmitKycDto,
    files: KycSubmissionFiles
  ): Promise<KycRecord> {
    this.logger.log(`Submitting KYC record for user: ${userId}`)
    // 1. Kiểm tra user có tồn tại không
    const oid = new ObjectId(userId)
    const user = await this.userRepository.findOne({
      where: { _id: oid },
    })
    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản người dùng')
    }

    if (user.kycStatus === 'verified') {
      throw new BadRequestException('Tài khoản đã được xác minh KYC thành công')
    }

    // 2. Xác thực khuôn mặt phía server (không tin kết quả client); lỗi thì không lưu gì
    const face = await this.ekycClient.verifyFace(files.selfie, files.frontCard)
    assertFaceVerified(face)

    // 3. Hồ sơ cũ (nếu có) nhúng trong user
    const existing = await this.findKycRowByUser(oid)
    const recordId = existing?.kyc.recordId ?? new ObjectId()
    const previousReferences = existing
      ? [
          existing.kyc.frontCardUrl,
          existing.kyc.backCardUrl,
          existing.kyc.selfieUrl,
        ]
      : []

    const storedReferences: string[] = []
    let frontCardUrl: string
    let backCardUrl: string
    let selfieUrl: string
    try {
      frontCardUrl = await this.storeMedia(
        userId,
        'front-card',
        files.frontCard,
        storedReferences
      )
      backCardUrl = await this.storeMedia(
        userId,
        'back-card',
        files.backCard,
        storedReferences
      )
      selfieUrl = await this.storeMedia(
        userId,
        'selfie',
        files.selfie,
        storedReferences
      )
    } catch (error) {
      await this.cleanupMedia(storedReferences)
      throw error
    }

    // 4. Trường của hồ sơ: giữ nguyên giá trị cũ cho trường DTO không gửi lên
    const now = new Date()
    const fields: Record<string, unknown> = {
      idCardNumber: dto.idCardNumber,
      frontCardUrl,
      backCardUrl,
      selfieUrl,
      faceMatchResult: face.match,
      livenessResult: face.liveness,
      spoofScore: face.spoofScore,
    }
    for (const key of OPTIONAL_DTO_FIELDS) {
      if (dto[key] !== undefined) fields[key] = dto[key]
    }
    const unset: Record<string, ''> = { 'kyc.ocrMatchRate': '' }

    // Cập nhật trạng thái
    fields.status = 'pending'
    fields.reviewedBy = null
    fields.verifiedAt = null
    fields.rejectedReason = null
    fields.createdAt = existing?.kyc.createdAt ?? now
    fields.updatedAt = now

    // 4. Ghi hồ sơ và trạng thái KYC trên User bằng MỘT updateOne nguyên tử theo trường
    const set: Record<string, unknown> = { 'kyc.recordId': recordId }
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) set[`kyc.${key}`] = value
    }
    set.kycStatus = 'pending'
    set.kycRejectReason = null
    set.updatedAt = now

    try {
      const result = await this.userRepository.updateOne(
        { _id: oid },
        {
          $set: set,
          $unset: unset,
        }
      )
      if (!isMatched(result)) {
        throw new NotFoundException('Không tìm thấy tài khoản người dùng')
      }
    } catch (error) {
      await this.cleanupMedia(storedReferences)
      throw error
    }

    await this.cleanupMedia(
      previousReferences.filter(reference =>
        reference?.startsWith('kyc-media:')
      )
    )

    this.logger.log(`KYC record submitted successfully for user: ${userId}`)
    return {
      ...fields,
      _id: recordId,
      userId,
    } as unknown as KycRecord
  }

  private async findKycRowByUser(oid: ObjectId): Promise<UserKycRow | null> {
    return this.findKycRow({ _id: oid })
  }

  private async findKycRowByRecordId(
    recordId: ObjectId
  ): Promise<UserKycRow | null> {
    return this.findKycRow({ 'kyc.recordId': recordId })
  }

  /** Đọc thô: TypeORM bỏ `kyc` khi nạp entity User (`@AfterLoad`). */
  private async findKycRow(
    match: Record<string, unknown>
  ): Promise<UserKycRow | null> {
    const rows = (await this.userRepository
      .aggregate([
        { $match: { ...match, kyc: { $type: 'object' } } },
        { $project: { email: 1, phone: 1, kycStatus: 1, kyc: 1 } },
        { $limit: 1 },
      ])
      .toArray()) as UserKycRow[]
    return rows[0] ?? null
  }

  private async storeMedia(
    userId: string,
    kind: KycMediaKind,
    file: Express.Multer.File,
    storedReferences: string[]
  ): Promise<string> {
    const reference = await this.kycMediaService.store(userId, kind, file)
    storedReferences.push(reference)
    return reference
  }

  private async cleanupMedia(references: string[]): Promise<void> {
    const results = await Promise.allSettled(
      references.map(reference => this.kycMediaService.remove(reference))
    )
    if (results.some(result => result.status === 'rejected')) {
      this.logger.warn('Could not remove one or more private KYC media files')
    }
  }
}

/** Chỉ cho nộp hồ sơ khi ảnh selfie là người thật và khớp với ảnh trên thẻ. */
function assertFaceVerified(face: EkycFaceResult): void {
  if (!face.liveness) {
    throw new UnprocessableEntityException(
      'Ảnh selfie không hợp lệ (nghi ngờ ảnh chụp lại). Vui lòng chụp trực tiếp khuôn mặt của bạn'
    )
  }
  if (!face.match) {
    throw new UnprocessableEntityException(
      'Khuôn mặt không khớp với ảnh trên thẻ. Vui lòng chụp lại selfie'
    )
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isMatched(result: unknown): boolean {
  return ((result as { matchedCount?: number } | null)?.matchedCount ?? 0) > 0
}

/** Hình JSON `KycRecord` cũ từ hàng `users` (userId = id người dùng, _id = recordId). */
function toKycRecord(row: UserKycRow): KycRecord {
  const { recordId, ...fields } = row.kyc
  return {
    ...fields,
    _id: recordId,
    userId: row._id.toHexString(),
  }
}

function toListItem(row: UserKycRow): KycListItem {
  const record = toKycRecord(row) as unknown as Record<string, unknown>
  for (const key of IMAGE_FIELDS) delete record[key]
  return {
    ...(record as Omit<
      KycRecord,
      'frontCardUrl' | 'backCardUrl' | 'selfieUrl'
    >),
    user: { email: row.email as string, phone: row.phone as string },
  }
}

function toSelfResult(record: KycRecord): KycSelfResult {
  return {
    id: record._id.toString(),
    status: record.status,
    rejectedReason: record.rejectedReason,
    idCardNumber: record.idCardNumber,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.fullName !== undefined ? { fullName: record.fullName } : {}),
    ...(record.dateOfBirth !== undefined
      ? { dateOfBirth: record.dateOfBirth }
      : {}),
    ...(record.gender !== undefined ? { gender: record.gender } : {}),
    ...(record.nationality !== undefined
      ? { nationality: record.nationality }
      : {}),
    ...(record.placeOfOrigin !== undefined
      ? { placeOfOrigin: record.placeOfOrigin }
      : {}),
    ...(record.placeOfResidence !== undefined
      ? { placeOfResidence: record.placeOfResidence }
      : {}),
    ...(record.issueDate !== undefined ? { issueDate: record.issueDate } : {}),
    ...(record.placeOfIssue !== undefined
      ? { placeOfIssue: record.placeOfIssue }
      : {}),
    ...(record.faceMatchResult !== undefined
      ? { faceMatchResult: record.faceMatchResult }
      : {}),
    ...(record.livenessResult !== undefined
      ? { livenessResult: record.livenessResult }
      : {}),
    ...(record.spoofScore !== undefined
      ? { realConfidence: record.spoofScore }
      : {}),
  }
}
