import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import * as crypto from 'crypto'
import { Contract } from './schemas/contract.schema'
import { PoliciesService } from '../policies/policies.service'
import { FabricService } from '../fabric/fabric.service'
import { KycService } from '../kyc/kyc.service'
import { EkycProxyService } from '../kyc/ekyc-proxy.service'

// ── Interfaces ──

interface CreateContractInput {
  propertyId: string
  propertyTitle: string
  propertyAddress?: string
  propertyArea?: number
  propertyFurniture?: string
  propertyValue: number
  landlordId: string
  landlordName?: string
  landlordCccd?: string
  landlordAddress?: string
  tenantId: string
  tenantName?: string
  tenantCccd?: string
  tenantAddress?: string
  startDate: string
  endDate: string
  monthlyRent: number
  deposit: number
  paymentDay: number
  latePenaltyRate: number
  terminationNoticeDays: number
}

/** Kết quả từ chaincode verifyContract */
interface ChainVerifyResult {
  valid: boolean
  reason: 'MATCH' | 'HASH_MISMATCH' | 'NOT_FOUND'
  onChainHash?: string
  txId?: string
  recordedAt?: string
}

// ── Service ──

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name)

  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    private readonly policiesService: PoliciesService,
    private readonly fabricService: FabricService,
    private readonly kycService: KycService,
    private readonly ekycProxyService: EkycProxyService
  ) {}

  // ── Private helpers ──

  /**
   * Tính SHA-256 của payload hợp đồng.
   * Dùng chung cho signContract() và verifyIntegrity() để đảm bảo tính nhất quán.
   */
  private buildContractHash(
    contract: Contract,
    policies: Record<string, string>
  ): string {
    const payload = JSON.stringify({
      contractCode: contract.contractCode,
      propertyId: contract.propertyId,
      propertyTitle: contract.propertyTitle,
      propertyAddress: contract.propertyAddress,
      propertyArea: contract.propertyArea,
      landlordId: contract.landlordId,
      landlordName: contract.landlordName,
      landlordCccd: contract.landlordCccd,
      tenantId: contract.tenantId,
      tenantName: contract.tenantName,
      tenantCccd: contract.tenantCccd,
      monthlyRent: contract.monthlyRent,
      deposit: contract.deposit,
      latePenaltyRate: contract.latePenaltyRate,
      terminationNoticeDays: contract.terminationNoticeDays,
      startDate: contract.startDate,
      endDate: contract.endDate,
      appliedPolicies: policies,
    })
    return crypto.createHash('sha256').update(payload).digest('hex')
  }

  // ── Tạo hợp đồng mới — validate theo chính sách pháp luật ──

  async createContract(input: CreateContractInput): Promise<Contract> {
    // Bước 1: Đọc chính sách pháp luật hiện hành từ MongoDB
    const [maxInterestRate, minNoticeDays, maxDepositPercent] =
      await Promise.all([
        this.policiesService.getValue(
          'MAX_LATE_PAYMENT_INTEREST_RATE_YEAR',
          '20'
        ),
        this.policiesService.getValue('MIN_TERMINATION_NOTICE_DAYS', '30'),
        this.policiesService.getValue('MAX_DEPOSIT_LIMIT_PERCENT', '5'),
      ])

    // Bước 2: Kiểm tra tuân thủ pháp luật (Compliance Check)
    const violations: string[] = []

    if (input.latePenaltyRate > Number(maxInterestRate)) {
      violations.push(
        `Lãi suất phạt chậm đóng ${input.latePenaltyRate}%/năm vượt mức tối đa ${maxInterestRate}%/năm ` +
          `theo Khoản 1 Điều 468 Bộ luật Dân sự 2015`
      )
    }

    if (input.terminationNoticeDays < Number(minNoticeDays)) {
      violations.push(
        `Thời hạn báo trước chấm dứt ${input.terminationNoticeDays} ngày thấp hơn tối thiểu ${minNoticeDays} ngày ` +
          `theo Khoản 3 Điều 130 Luật Nhà ở 2023`
      )
    }

    if (input.propertyValue > 0) {
      const depositPercent = (input.deposit / input.propertyValue) * 100
      if (depositPercent > Number(maxDepositPercent)) {
        violations.push(
          `Tiền cọc ${input.deposit.toLocaleString('vi-VN')}đ chiếm ${depositPercent.toFixed(1)}% giá trị tài sản, ` +
            `vượt mức tối đa ${maxDepositPercent}% theo Khoản 5 Điều 23 Luật KDBDS 2023`
        )
      }
    }

    const start = new Date(input.startDate)
    const end = new Date(input.endDate)
    if (end <= start) {
      violations.push('Ngày kết thúc hợp đồng phải sau ngày bắt đầu')
    }

    if (violations.length > 0) {
      throw new BadRequestException({
        message: 'Hợp đồng vi phạm quy định pháp luật',
        violations,
      })
    }

    // Bước 3: Tạo mã hợp đồng duy nhất
    const contractCode = `HD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`

    // Bước 4: Lưu hợp đồng vào MongoDB
    const contract = new Contract()
    contract.contractCode = contractCode
    contract.propertyId = input.propertyId
    contract.propertyTitle = input.propertyTitle
    contract.propertyAddress = input.propertyAddress ?? null
    contract.propertyArea = input.propertyArea ?? null
    contract.propertyFurniture = input.propertyFurniture ?? null
    contract.propertyValue = input.propertyValue
    contract.landlordId = input.landlordId
    contract.landlordName = input.landlordName ?? null
    contract.landlordCccd = input.landlordCccd ?? null
    contract.landlordAddress = input.landlordAddress ?? null
    contract.tenantId = input.tenantId
    contract.tenantName = input.tenantName ?? null
    contract.tenantCccd = input.tenantCccd ?? null
    contract.tenantAddress = input.tenantAddress ?? null
    contract.startDate = start
    contract.endDate = end
    contract.monthlyRent = input.monthlyRent
    contract.deposit = input.deposit
    contract.paymentDay = input.paymentDay
    contract.latePenaltyRate = input.latePenaltyRate
    contract.terminationNoticeDays = input.terminationNoticeDays
    contract.status = 'awaiting-signature'
    contract.signedByTenant = false
    contract.signedByLandlord = false
    contract.contractHash = null
    contract.blockchainAddress = null
    contract.appliedPolicies = null

    const saved = await this.contractRepository.save(contract)
    this.logger.log(`Contract created: ${contractCode}`)
    return saved
  }

  // ── Ký hợp đồng — snapshot chính sách & đẩy lên blockchain ──

  async signContract(
    contractId: string,
    role: 'tenant' | 'landlord'
  ): Promise<Contract> {
    const contract = await this.contractRepository.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    if (!contract) {
      throw new NotFoundException('Không tìm thấy hợp đồng')
    }
    if (contract.status !== 'awaiting-signature') {
      throw new BadRequestException('Hợp đồng không ở trạng thái chờ ký')
    }

    // Bước 1: Xác minh KYC của người ký trước khi chấp nhận chữ ký
    const userId = role === 'tenant' ? contract.tenantId : contract.landlordId
    const kyc = await this.kycService.findByUserId(userId)
    if (!kyc || kyc.status !== 'verified') {
      throw new BadRequestException(
        `Người ký (${role}) chưa hoàn tất xác minh KYC hoặc hồ sơ chưa được phê duyệt`
      )
    }

    // Bước 2: Cập nhật chữ ký
    if (role === 'tenant') contract.signedByTenant = true
    if (role === 'landlord') contract.signedByLandlord = true

    // Bước 3: Nếu cả hai đã ký → kích hoạt hợp đồng & neo hash lên blockchain
    if (contract.signedByTenant && contract.signedByLandlord) {
      contract.status = 'active'

      // Snapshot toàn bộ chính sách pháp luật tại thời điểm ký
      const allPolicies = await this.policiesService.findAll()
      const snapshot: Record<string, string> = {}
      for (const p of allPolicies) {
        if (p.status === 'active') {
          snapshot[p.key] = p.value
        }
      }
      contract.appliedPolicies = snapshot

      // Tạo mã băm SHA-256 bất biến của nội dung hợp đồng (PII + điều khoản + chính sách pháp luật áp dụng)
      contract.contractHash = this.buildContractHash(contract, snapshot)

      // Đẩy hash lên Hyperledger Fabric (chỉ neo hash — PII không lên ledger)
      const txResult = await this.fabricService.submitTransaction(
        'createContract',
        [
          contractId,
          contract.contractCode,
          contract.tenantId,
          contract.landlordId,
          contract.contractHash,
          contract.monthlyRent.toString(),
          contract.startDate.toISOString(),
        ],
        { contractId }
      )

      contract.blockchainAddress = txResult.txHash
      this.logger.log(
        `Contract ${contract.contractCode} activated & recorded on blockchain: ${txResult.txHash}`
      )
    }

    return this.contractRepository.save(contract)
  }

  // ── Lấy chi tiết hợp đồng ──

  async findOne(contractId: string): Promise<Contract> {
    const contract = await this.contractRepository.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    if (!contract) {
      throw new NotFoundException('Không tìm thấy hợp đồng')
    }
    return contract
  }

  // ── Lấy danh sách hợp đồng theo người dùng ──

  async findByUser(userId: string): Promise<Contract[]> {
    const [asLandlord, asTenant] = await Promise.all([
      this.contractRepository.find({
        where: { landlordId: userId },
        order: { createdAt: 'DESC' },
      }),
      this.contractRepository.find({
        where: { tenantId: userId },
        order: { createdAt: 'DESC' },
      }),
    ])

    // Gộp và loại bỏ trùng lặp (một user có thể vừa là chủ nhà vừa là khách thuê)
    const map = new Map<string, Contract>()
    for (const c of [...asLandlord, ...asTenant]) {
      map.set(c._id.toHexString(), c)
    }
    return Array.from(map.values())
  }

  // ── Xác minh tính toàn vẹn hợp đồng — so sánh với Hyperledger Fabric ──

  /**
   * Xác minh tính toàn vẹn hợp đồng qua 2 lớp:
   *
   * 1. Tính lại hash từ dữ liệu MongoDB hiện tại → so với hash lưu trong MongoDB.
   * 2. Gọi chaincode.verifyContract() trên Hyperledger Fabric → hash trên ledger (bất biến).
   *
   * isValid = TRUE chỉ khi cả 2 lớp đều khớp.
   * Nếu MongoDB bị tamper nhưng ledger không đổi được → isValid = FALSE.
   */
  async verifyIntegrity(contractId: string): Promise<{
    isValid: boolean
    currentHash: string
    storedHash: string | null
    blockchainAddress: string | null
    onChain: ChainVerifyResult | null
  }> {
    const contract = await this.findOne(contractId)

    // Lớp 1: Tính lại hash từ dữ liệu MongoDB
    const currentHash = this.buildContractHash(
      contract,
      contract.appliedPolicies ?? {}
    )
    const mongoMatch = currentHash === contract.contractHash

    // Lớp 2: Đối chiếu với hash bất biến trên Hyperledger Fabric
    let onChain: ChainVerifyResult | null = null
    if (contract.blockchainAddress) {
      try {
        onChain = (await this.fabricService.evaluateTransaction(
          'verifyContract',
          [contractId, currentHash]
        )) as ChainVerifyResult
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        this.logger.warn(
          `Không thể truy vấn Fabric để xác minh hợp đồng ${contractId}: ${errMsg}`
        )
      }
    }

    const chainMatch = onChain !== null ? onChain.valid : true

    return {
      isValid: mongoMatch && chainMatch,
      currentHash,
      storedHash: contract.contractHash,
      blockchainAddress: contract.blockchainAddress,
      onChain,
    }
  }

  // ── Xác thực khuôn mặt người ký hợp đồng ──

  async verifySigner(
    contractId: string,
    role: 'tenant' | 'landlord',
    selfie: Express.Multer.File
  ): Promise<{
    verified: boolean
    faceMatch: boolean
    liveness: boolean
    spoofScore: number
  }> {
    this.logger.log(
      `Verifying signer identity for contract ${contractId}, role: ${role}`
    )

    let userId: string
    try {
      const contract = await this.findOne(contractId)
      userId = role === 'tenant' ? contract.tenantId : contract.landlordId
    } catch {
      this.logger.warn(
        `Contract ${contractId} not found. Falling back to contractId as userId.`
      )
      userId = contractId
    }

    if (!userId || !ObjectId.isValid(userId)) {
      throw new BadRequestException(
        `Hợp đồng thiếu thông tin ID hoặc ID không hợp lệ cho ${role}`
      )
    }

    const kycRecord = await this.kycService.findByUserId(userId)
    if (!kycRecord || kycRecord.status !== 'verified') {
      throw new BadRequestException(
        `Người ký (${role}) chưa hoàn tất xác minh KYC hoặc trạng thái không hợp lệ`
      )
    }

    if (!kycRecord.frontCardUrl) {
      throw new BadRequestException(
        'Hồ sơ KYC thiếu ảnh mặt trước CCCD để đối sánh'
      )
    }

    const verificationResult = await this.ekycProxyService.verifySigner(
      selfie,
      kycRecord.frontCardUrl
    )

    const isMatch = verificationResult.results?.face_matching === true
    const isLive = verificationResult.results?.liveness === true

    return {
      verified: isMatch && isLive,
      faceMatch: isMatch,
      liveness: isLive,
      spoofScore: verificationResult.results?.spoof_score ?? 0,
    }
  }
}
