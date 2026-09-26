import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import type {
  ContractCommercialAuditEvent,
  ContractCommercialDraft,
} from './schemas/contract.schema'
import { Contract } from './schemas/contract.schema'
import type {
  ContractCommercialEditorResponseDto,
  ContractCommercialValidationDto,
} from './dto/contract-commercial-editor.dto'
import { isUtilityParty } from './dto/contract-commercial-editor.dto'

export const PROTECTED_CONTRACT_EDITOR_FIELDS = Object.freeze([
  'legalProfile',
  'clauses',
  'citations',
  'tenantId',
  'landlordId',
  'propertyId',
  'termsRef',
  'contractTemplateRef',
  'contentLockedHash',
  'artifactRef',
  'tenantSignature',
  'landlordSignature',
  'ledgerStatus',
])

const ALLOWED_ADDENDA = new Set([
  'HANDOVER_RECORD',
  'INVENTORY_LIST',
  'BUILDING_RULES',
  'DEPOSIT_RECEIPT',
])

const ALLOWED_COMMERCIAL_FIELDS = new Set<keyof ContractCommercialDraft>([
  'monthlyRent',
  'deposit',
  'paymentDay',
  'latePenaltyRate',
  'terminationNoticeDays',
  'durationMonths',
  'utilities',
  'handoverNotes',
  'inventoryReference',
  'noticePeriodDays',
  'addendaIds',
])

@Injectable()
export class ContractCommercialEditorService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>
  ) {}

  async getEditor(
    contractId: string,
    actorId: string,
    isAdmin: boolean
  ): Promise<ContractCommercialEditorResponseDto> {
    const contract = await this.findContract(contractId)
    this.assertAdmin(actorId, isAdmin)
    return this.toResponse(contract)
  }

  async validateDraft(
    contractId: string,
    input: ContractCommercialDraft,
    actorId: string,
    isAdmin: boolean
  ): Promise<ContractCommercialValidationDto> {
    const contract = await this.findContract(contractId)
    this.assertAdmin(actorId, isAdmin)
    return this.validation(
      input,
      contract.commercialDraft ?? this.baseCommercial(contract)
    )
  }

  async saveDraft(
    contractId: string,
    input: ContractCommercialDraft,
    expectedRevision: number,
    actorId: string,
    isAdmin: boolean
  ): Promise<ContractCommercialEditorResponseDto> {
    const contract = await this.findContract(contractId)
    this.assertAdmin(actorId, isAdmin)
    if (contract.contentLockedHash || contract.contentLockedAt) {
      throw new ConflictException('CONTRACT_COMMERCIAL_EDITOR_LOCKED')
    }
    if (
      ['active', 'terminated', 'completed', 'cancelled'].includes(
        contract.status ?? ''
      )
    ) {
      throw new ConflictException('CONTRACT_COMMERCIAL_EDITOR_STATE_CLOSED')
    }
    if ((contract.commercialRevision ?? 0) !== expectedRevision) {
      throw new ConflictException('CONTRACT_COMMERCIAL_REVISION_STALE')
    }
    const current = contract.commercialDraft ?? this.baseCommercial(contract)
    const validation = this.validation(input, current)
    if (!validation.valid)
      throw new ConflictException(validation.errors.join(','))
    const beforeHash = this.hash(current)
    const afterHash = this.hash(input)
    const auditEvent: ContractCommercialAuditEvent = {
      actorId,
      revision: (contract.commercialRevision ?? 0) + 1,
      changedFields: validation.changedFields,
      beforeHash,
      afterHash,
      createdAt: new Date(),
    }
    contract.commercialDraft = this.cloneDraft(input)
    contract.commercialRevision = auditEvent.revision
    contract.commercialAudit = [...(contract.commercialAudit ?? []), auditEvent]
    return this.toResponse(await this.contractRepository.save(contract))
  }

  private validation(
    input: ContractCommercialDraft,
    previous?: ContractCommercialDraft | null
  ): ContractCommercialValidationDto {
    const errors: string[] = []
    if (
      Object.keys(input).some(
        field =>
          !ALLOWED_COMMERCIAL_FIELDS.has(field as keyof ContractCommercialDraft)
      )
    ) {
      errors.push('COMMERCIAL_FIELD_NOT_ALLOWED')
    }
    if (!Number.isFinite(input.monthlyRent) || input.monthlyRent < 0)
      errors.push('MONTHLY_RENT_INVALID')
    if (!Number.isFinite(input.deposit) || input.deposit < 0)
      errors.push('DEPOSIT_INVALID')
    if (
      !Number.isInteger(input.paymentDay) ||
      input.paymentDay < 1 ||
      input.paymentDay > 31
    )
      errors.push('PAYMENT_DAY_INVALID')
    if (input.latePenaltyRate < 0 || input.latePenaltyRate > 20)
      errors.push('LATE_PENALTY_RATE_INVALID')
    if (input.terminationNoticeDays < 1 || input.terminationNoticeDays > 365)
      errors.push('TERMINATION_NOTICE_INVALID')
    if (input.durationMonths < 1 || input.durationMonths > 120)
      errors.push('DURATION_INVALID')
    if (input.addendaIds?.some(id => !ALLOWED_ADDENDA.has(id)))
      errors.push('COMMERCIAL_ADDENDUM_NOT_ALLOWED')
    if (
      input.utilities &&
      Object.values(input.utilities).some(value => !isUtilityParty(value))
    )
      errors.push('UTILITY_PARTY_INVALID')
    const changedFields = this.changedFields(previous, input)
    return { valid: errors.length === 0, errors, changedFields }
  }

  private changedFields(
    previous: ContractCommercialDraft | null | undefined,
    next: ContractCommercialDraft
  ): string[] {
    if (!previous) return Object.keys(next)
    return Object.keys(next).filter(
      key =>
        JSON.stringify(previous[key as keyof ContractCommercialDraft]) !==
        JSON.stringify(next[key as keyof ContractCommercialDraft])
    )
  }

  private toResponse(contract: Contract): ContractCommercialEditorResponseDto {
    return {
      contractId: contract._id.toHexString(),
      revision: contract.commercialRevision ?? 0,
      commercial: contract.commercialDraft ?? this.baseCommercial(contract),
      protectedFields: [...PROTECTED_CONTRACT_EDITOR_FIELDS],
      locked: Boolean(contract.contentLockedHash || contract.contentLockedAt),
    }
  }

  private cloneDraft(input: ContractCommercialDraft): ContractCommercialDraft {
    return JSON.parse(JSON.stringify(input)) as ContractCommercialDraft
  }

  private baseCommercial(contract: Contract): ContractCommercialDraft {
    return {
      monthlyRent: contract.monthlyRent,
      deposit: contract.deposit,
      paymentDay: contract.paymentDay,
      latePenaltyRate: contract.latePenaltyRate,
      terminationNoticeDays: contract.terminationNoticeDays,
      durationMonths: contract.durationMonths ?? 12,
    }
  }

  private hash(input: ContractCommercialDraft): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex')
  }

  private assertAdmin(actorId: string, isAdmin: boolean): void {
    if (!isAdmin || !actorId)
      throw new ForbiddenException('CONTRACT_ADMIN_EDITOR_ACCESS_DENIED')
  }

  private async findContract(contractId: string): Promise<Contract> {
    if (!ObjectId.isValid(contractId))
      throw new NotFoundException('CONTRACT_NOT_FOUND')
    const contract = await this.contractRepository.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    if (!contract) throw new NotFoundException('CONTRACT_NOT_FOUND')
    return contract
  }
}
