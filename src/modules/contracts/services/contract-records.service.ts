import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'
import type {
  ContractRecordDto,
  ContractRecordsPageDto,
} from '../dto/contract-record.dto'
import {
  CONTRACT_RECORDS_DEFAULT_PAGE_SIZE,
  CONTRACT_RECORDS_MAX_PAGE_SIZE,
  type ContractRecordsQueryDto,
} from '../dto/contract-records-query.dto'
import { Contract } from '../schemas/contract.schema'
import { ContractDocument } from '../schemas/contract-document.schema'

type MongoWhere = Record<string, unknown>
const asWhere = (where: MongoWhere): never => where as never

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Escape ký tự đặc biệt của regex để chuỗi người dùng nhập chỉ được hiểu là văn bản thường. */
function containsText(value: string): MongoWhere {
  return {
    $regex: value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    $options: 'i',
  }
}

/** Ngày không kèm giờ ở cận trên nghĩa là hết ngày đó. */
function endOfRange(value: string): Date {
  return new Date(DATE_ONLY.test(value) ? `${value}T23:59:59.999Z` : value)
}

/**
 * Tra cứu hồ sơ hợp đồng cho Admin/Staff (capability admin-contract-records). Chỉ đọc, trả bản chiếu
 * an toàn: không CCCD, địa chỉ cá nhân, số điện thoại hay tham chiếu tệp ký.
 */
@Injectable()
export class ContractRecordsService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(ContractDocument)
    private readonly documentRepository: Repository<ContractDocument>
  ) {}

  async listRecords(
    query: ContractRecordsQueryDto
  ): Promise<ContractRecordsPageDto> {
    const page = Math.max(1, query.page ?? 1)
    const pageSize = Math.min(
      CONTRACT_RECORDS_MAX_PAGE_SIZE,
      Math.max(1, query.pageSize ?? CONTRACT_RECORDS_DEFAULT_PAGE_SIZE)
    )

    // findAndCount nhận find options ({ where }); KHÔNG dùng repository.count({ where }) với Mongo.
    const [contracts, total] = await this.contractRepository.findAndCount({
      where: asWhere(this.buildWhere(query)),
      order: { createdAt: 'DESC', _id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })

    const summaries = await this.summarizeDocuments(
      contracts.map(contract => contract._id.toHexString())
    )

    return {
      items: contracts.map(contract => {
        const id = contract._id.toHexString()
        const summary = summaries.get(id)
        return this.toRecord(contract, id, summary)
      }),
      total,
      page,
      pageSize,
    }
  }

  private buildWhere(query: ContractRecordsQueryDto): MongoWhere {
    const clauses: MongoWhere[] = []
    if (query.property) {
      const text = containsText(query.property)
      clauses.push({
        $or: [{ propertyTitle: text }, { propertyAddress: text }],
      })
    }
    if (query.tenant) clauses.push({ tenantName: containsText(query.tenant) })
    if (query.landlord) {
      clauses.push({ landlordName: containsText(query.landlord) })
    }
    if (query.status) clauses.push({ status: query.status })
    if (query.from) clauses.push({ createdAt: { $gte: new Date(query.from) } })
    if (query.to) clauses.push({ createdAt: { $lte: endOfRange(query.to) } })
    return clauses.length > 0 ? { $and: clauses } : {}
  }

  /** Một truy vấn theo lô cho cả trang: revision canonical mới nhất và cờ đã có bản ký. */
  private async summarizeDocuments(
    contractIds: string[]
  ): Promise<
    Map<string, { latestRevision: number | null; hasSigned: boolean }>
  > {
    const summaries = new Map<
      string,
      { latestRevision: number | null; hasSigned: boolean }
    >()
    if (contractIds.length === 0) return summaries

    const documents = await this.documentRepository.find({
      where: asWhere({
        contractId: { $in: contractIds },
        kind: { $in: ['canonical', 'signed'] },
      }),
    })
    for (const document of documents) {
      const current = summaries.get(document.contractId) ?? {
        latestRevision: null,
        hasSigned: false,
      }
      if (document.kind === 'signed') current.hasSigned = true
      if (
        document.kind === 'canonical' &&
        (current.latestRevision === null ||
          document.revision > current.latestRevision)
      ) {
        current.latestRevision = document.revision
      }
      summaries.set(document.contractId, current)
    }
    return summaries
  }

  private toRecord(
    contract: Contract,
    id: string,
    summary: { latestRevision: number | null; hasSigned: boolean } | undefined
  ): ContractRecordDto {
    return {
      id,
      contractCode: contract.contractCode,
      propertyId: contract.propertyId,
      propertyTitle: contract.propertyTitle,
      landlordId: contract.landlordId,
      landlordName: contract.landlordName ?? null,
      tenantId: contract.tenantId,
      tenantName: contract.tenantName ?? null,
      startDate: contract.startDate,
      endDate: contract.endDate,
      status: contract.status ?? 'draft',
      createdAt: contract.createdAt,
      latestRevision: summary?.latestRevision ?? null,
      hasSigned: summary?.hasSigned ?? false,
    }
  }
}
