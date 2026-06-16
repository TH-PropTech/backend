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

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name)

  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    private readonly policiesService: PoliciesService,
    private readonly fabricService: FabricService
  ) {}

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

    // Kiểm tra lãi suất phạt — Khoản 1 Điều 468 BLDS 2015
    if (input.latePenaltyRate > Number(maxInterestRate)) {
      violations.push(
        `Lãi suất phạt chậm đóng ${input.latePenaltyRate}%/năm vượt mức tối đa ${maxInterestRate}%/năm ` +
          `theo Khoản 1 Điều 468 Bộ luật Dân sự 2015`
      )
    }

    // Kiểm tra thời hạn báo trước chấm dứt — Khoản 3 Điều 130 LNO 2023
    if (input.terminationNoticeDays < Number(minNoticeDays)) {
      violations.push(
        `Thời hạn báo trước chấm dứt ${input.terminationNoticeDays} ngày thấp hơn tối thiểu ${minNoticeDays} ngày ` +
          `theo Khoản 3 Điều 130 Luật Nhà ở 2023`
      )
    }

    // Kiểm tra tỷ lệ cọc — Khoản 5 Điều 23 LKDBDS 2023
    if (input.propertyValue > 0) {
      const depositPercent = (input.deposit / input.propertyValue) * 100
      if (depositPercent > Number(maxDepositPercent)) {
        violations.push(
          `Tiền cọc ${input.deposit.toLocaleString('vi-VN')}đ chiếm ${depositPercent.toFixed(1)}% giá trị tài sản, ` +
            `vượt mức tối đa ${maxDepositPercent}% theo Khoản 5 Điều 23 Luật KDBDS 2023`
        )
      }
    }

    // Kiểm tra thời hạn hợp đồng hợp lệ
    const start = new Date(input.startDate)
    const end = new Date(input.endDate)
    if (end <= start) {
      violations.push('Ngày kết thúc hợp đồng phải sau ngày bắt đầu')
    }

    // Nếu có vi phạm, từ chối tạo hợp đồng
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

    // Cập nhật chữ ký
    if (role === 'tenant') contract.signedByTenant = true
    if (role === 'landlord') contract.signedByLandlord = true

    // Nếu cả hai đã ký → kích hoạt hợp đồng
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

      // Tạo mã băm SHA-256 nội dung hợp đồng (bao gồm thông tin danh tính số & tài sản để đảm bảo tính pháp lý bất biến)
      const hashPayload = JSON.stringify({
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
        appliedPolicies: snapshot,
      })
      contract.contractHash = crypto
        .createHash('sha256')
        .update(hashPayload)
        .digest('hex')

      // Đẩy lên Hyperledger Fabric blockchain
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
    const asLandlord = await this.contractRepository.find({
      where: { landlordId: userId },
      order: { createdAt: 'DESC' },
    })
    const asTenant = await this.contractRepository.find({
      where: { tenantId: userId },
      order: { createdAt: 'DESC' },
    })

    // Gộp và loại bỏ trùng lặp
    const map = new Map<string, Contract>()
    for (const c of [...asLandlord, ...asTenant]) {
      map.set(c._id.toHexString(), c)
    }
    return Array.from(map.values())
  }

  // ── Xác minh tính toàn vẹn hợp đồng với blockchain ──

  async verifyIntegrity(contractId: string): Promise<{
    isValid: boolean
    currentHash: string
    storedHash: string | null
    blockchainAddress: string | null
  }> {
    const contract = await this.findOne(contractId)

    // Tính lại hash từ dữ liệu hiện tại
    const hashPayload = JSON.stringify({
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
      appliedPolicies: contract.appliedPolicies,
    })
    const currentHash = crypto
      .createHash('sha256')
      .update(hashPayload)
      .digest('hex')

    return {
      isValid: currentHash === contract.contractHash,
      currentHash,
      storedHash: contract.contractHash,
      blockchainAddress: contract.blockchainAddress,
    }
  }
}
