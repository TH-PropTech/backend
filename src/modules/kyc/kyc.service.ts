import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, FindManyOptions, FindOptionsWhere } from 'typeorm'
import { ObjectId } from 'mongodb'
import { KycRecord } from './schemas/kyc-record.schema'
import { User } from '../users/schemas/user.schema'
import { SubmitKycDto } from './dto/submit-kyc.dto'

export interface KycListResult {
  items: (KycRecord & { user?: { email: string; phone: string } | null })[]
  total: number
  page: number
  limit: number
  totalPages: number
}

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name)

  constructor(
    @InjectRepository(KycRecord)
    private readonly kycRepository: Repository<KycRecord>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>
  ) {}

  /**
   * Lấy danh sách hồ sơ KYC — Staff giám sát.
   * Hỗ trợ lọc theo status, tìm kiếm theo tên/số CCCD, phân trang.
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

    const where: Record<string, unknown> = {}
    if (query.status) {
      where.status = query.status
    }

    const options: FindManyOptions<KycRecord> = {
      order: { createdAt: 'DESC' },
    }
    if (Object.keys(where).length > 0) {
      options.where = where
    }

    // Lấy tất cả rồi filter bằng code (TypeORM MongoDB driver hạn chế regex)
    const allRecords = await this.kycRepository.find(options)

    // Lấy thông tin user tương ứng
    const userIds = allRecords.map(r => r.userId).filter(Boolean)
    const users =
      userIds.length > 0
        ? await this.userRepository.find({
            where: {
              _id: { $in: userIds.map(id => new ObjectId(id)) },
            } as unknown as FindOptionsWhere<User>,
          })
        : []
    const userMap = new Map(users.map(u => [u._id.toString(), u]))

    const enrichedRecords = allRecords.map(record => ({
      ...record,
      user: userMap.has(record.userId)
        ? {
            email: userMap.get(record.userId)!.email,
            phone: userMap.get(record.userId)!.phone,
          }
        : null,
    }))

    // Tìm kiếm theo tên hoặc số CCCD
    let filtered = enrichedRecords
    if (query.search) {
      const searchStr = query.search
      const searchLower = searchStr.toLowerCase()
      filtered = enrichedRecords.filter(
        record =>
          (record.fullName &&
            record.fullName.toLowerCase().includes(searchLower)) ||
          record.idCardNumber.includes(searchStr)
      )
    }

    const total = filtered.length
    const totalPages = Math.ceil(total / query.limit)
    const skip = (query.page - 1) * query.limit
    const items = filtered.slice(skip, skip + query.limit)

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages,
    }
  }

  /**
   * Lấy chi tiết 1 hồ sơ KYC theo ID.
   */
  async findOne(
    id: string
  ): Promise<KycRecord & { user?: { email: string; phone: string } | null }> {
    this.logger.log(`Fetching KYC record: ${id}`)
    try {
      const record = await this.kycRepository.findOne({
        where: { _id: new ObjectId(id) },
      })
      if (!record) {
        throw new NotFoundException(`Không tìm thấy hồ sơ KYC: ${id}`)
      }
      const user = await this.userRepository.findOne({
        where: { _id: new ObjectId(record.userId) },
      })
      return {
        ...record,
        user: user
          ? {
              email: user.email,
              phone: user.phone,
            }
          : null,
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
    return this.kycRepository.findOne({
      where: { userId },
    })
  }

  /**
   * Staff duyệt hoặc từ chối hồ sơ KYC.
   * Đồng thời cập nhật kycStatus trên User entity.
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

    const record = await this.kycRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!record) {
      throw new NotFoundException(`Không tìm thấy hồ sơ KYC: ${id}`)
    }

    if (record.status !== 'pending') {
      throw new BadRequestException(
        `Hồ sơ KYC đã ở trạng thái "${record.status}", không thể duyệt lại`
      )
    }

    // Cập nhật KYC record
    record.status = status
    record.reviewedBy = reviewedBy
    if (status === 'verified') {
      record.verifiedAt = new Date()
      record.rejectedReason = null
    } else {
      record.rejectedReason = rejectedReason ?? null
      record.verifiedAt = null
    }

    await this.kycRepository.save(record)

    // Đồng bộ kycStatus trên User
    await this.syncUserKycStatus(record.userId, status, rejectedReason)

    return this.findOne(id)
  }

  /**
   * Đếm số hồ sơ KYC theo trạng thái — dùng cho dashboard metrics.
   */
  async countByStatus(): Promise<
    Record<'pending' | 'verified' | 'rejected' | 'total', number>
  > {
    const all = await this.kycRepository.find()
    const counts = { pending: 0, verified: 0, rejected: 0, total: all.length }

    for (const record of all) {
      if (record.status in counts) {
        counts[record.status]++
      }
    }

    return counts
  }

  /**
   * Đồng bộ kycStatus trên User entity khi KYC record được duyệt/từ chối.
   */
  private async syncUserKycStatus(
    userId: string,
    status: 'verified' | 'rejected',
    rejectReason?: string
  ): Promise<void> {
    try {
      const user = await this.userRepository.findOne({
        where: { _id: new ObjectId(userId) },
      })
      if (user) {
        user.kycStatus = status
        user.kycRejectReason =
          status === 'rejected' ? (rejectReason ?? null) : null
        await this.userRepository.save(user)
        this.logger.log(`Synced user ${userId} kycStatus to "${status}"`)
      }
    } catch (err) {
      this.logger.warn(
        `Failed to sync user KYC status: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  /**
   * Người dùng nộp hồ sơ KYC.
   * Tạo mới hoặc cập nhật hồ sơ cũ nếu đã có.
   */
  async submitKyc(userId: string, dto: SubmitKycDto): Promise<KycRecord> {
    this.logger.log(`Submitting KYC record for user: ${userId}`)

    // 1. Kiểm tra user có tồn tại không
    const user = await this.userRepository.findOne({
      where: { _id: new ObjectId(userId) },
    })
    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản người dùng')
    }

    if (user.kycStatus === 'verified') {
      throw new BadRequestException('Tài khoản đã được xác minh KYC thành công')
    }

    // 2. Tìm KYC record cũ của user này
    let record = await this.kycRepository.findOne({
      where: { userId },
    })

    if (!record) {
      record = new KycRecord()
      record.userId = userId
    }

    // 3. Cập nhật các trường từ DTO
    record.idCardNumber = dto.idCardNumber
    record.frontCardUrl = dto.frontCardUrl
    record.backCardUrl = dto.backCardUrl
    record.selfieUrl = dto.selfieUrl

    if (dto.fullName !== undefined) record.fullName = dto.fullName
    if (dto.dateOfBirth !== undefined) record.dateOfBirth = dto.dateOfBirth
    if (dto.gender !== undefined) record.gender = dto.gender
    if (dto.nationality !== undefined) record.nationality = dto.nationality
    if (dto.placeOfOrigin !== undefined)
      record.placeOfOrigin = dto.placeOfOrigin
    if (dto.placeOfResidence !== undefined)
      record.placeOfResidence = dto.placeOfResidence
    if (dto.issueDate !== undefined) record.issueDate = dto.issueDate
    if (dto.placeOfIssue !== undefined) record.placeOfIssue = dto.placeOfIssue
    if (dto.faceMatchResult !== undefined)
      record.faceMatchResult = dto.faceMatchResult
    if (dto.livenessResult !== undefined)
      record.livenessResult = dto.livenessResult
    if (dto.spoofScore !== undefined) record.spoofScore = dto.spoofScore
    if (dto.ocrMatchRate !== undefined) record.ocrMatchRate = dto.ocrMatchRate

    // Cập nhật trạng thái
    record.status = 'pending'
    record.reviewedBy = null
    record.verifiedAt = null
    record.rejectedReason = null

    // 4. Lưu KYC record
    const savedRecord = await this.kycRepository.save(record)

    // 5. Cập nhật trạng thái trên User entity
    user.kycStatus = 'pending'
    user.kycRejectReason = null
    await this.userRepository.save(user)

    this.logger.log(`KYC record submitted successfully for user: ${userId}`)
    return savedRecord
  }
}
