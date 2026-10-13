import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { BookingsService } from '../../bookings/services/bookings.service'
import { PlatformFeesService } from '../../platform-fees/services/platform-fees.service'
import { UnprocessableEntityException } from '@nestjs/common'
import { ApartmentsService } from '../../properties/services/apartments.service'
import type { RentalPackageRecord } from '../../properties/utils/rental-package.util'
import { ContractsService } from '../../contracts/services/contracts.service'
import { DepositAgreementsService } from '../../contracts/services/deposit-agreements.service'
import { NotificationsService } from '../../notifications/services/notifications.service'
import { LegalTermsService } from '../../legal/services/legal-terms.service'
import { RentalFlowConfigResolver } from '../../rental-flow-config/services/rental-flow-config-resolver.service'
import { RentalExecutionPoliciesService } from '../../rental-flow-config/services/rental-execution-policies.service'
import { OwnershipTransferResolver } from '../../property-ownership-transfer/services/ownership-transfer.resolver'
import { RentalTransactionEventService } from './rental-transaction-event.service'
import {
  getDefaultRentalExecutionPolicyRef,
  type RentalExecutionPolicyRef,
} from '../../rental-flow-config/utils/rental-execution-policy.util'
import { CreateRentalApplicationDto } from '../dto/create-rental-application.dto'
import type { RentalApplicationContext } from '../dto/rental-application-context.dto'
import { RentalApplicationQueryDto } from '../dto/rental-application-query.dto'
import { RespondRentalApplicationDto } from '../dto/respond-rental-application.dto'
import {
  buildRentalDisclosureHash,
  buildRentalReviewHash,
  hasRequiredRentalDisclosures,
  RENTAL_REVIEW_DISCLOSURES,
  RENTAL_REVIEW_DISCLOSURE_VERSION,
  type RentalApplicationListingSnapshot,
} from '../utils/rental-application-review.util'
import {
  ContractHandoff,
  RentalApplication,
} from '../schemas/rental-application.schema'

export interface RentalApplicationListResult {
  items: RentalApplication[]
  total: number
  page: number
  limit: number
  totalPages: number
}

const COMPATIBILITY_PACKAGE_ID = 'compatibility-12m'
const COMPATIBILITY_PACKAGE_VERSION = 1

@Injectable()
export class RentalApplicationsService {
  private readonly logger = new Logger(RentalApplicationsService.name)

  constructor(
    @InjectRepository(RentalApplication)
    private readonly repository: Repository<RentalApplication>,
    private readonly apartmentsService: ApartmentsService,
    @Optional() private readonly configService?: ConfigService,
    @Optional()
    private readonly depositAgreementsService?: DepositAgreementsService,
    @Optional() private readonly contractsService?: ContractsService,
    @Optional() private readonly notificationsService?: NotificationsService,
    @Optional() private readonly legalTermsService?: LegalTermsService,
    @Optional() private readonly flowConfigResolver?: RentalFlowConfigResolver,
    @Optional()
    private readonly executionPoliciesService?: RentalExecutionPoliciesService,
    @Optional()
    private readonly ownershipTransferResolver?: OwnershipTransferResolver,
    @Optional() private readonly bookingsService?: BookingsService,
    @Optional() private readonly platformFeesService?: PlatformFeesService,
    @Optional()
    private readonly transactionEventService?: RentalTransactionEventService
  ) {}

  async getContext(
    tenantId: string,
    apartmentId: string
  ): Promise<RentalApplicationContext> {
    const apartment = await this.apartmentsService.findOne(apartmentId)
    const listing = this.toListingSnapshot(apartment)
    let terms: RentalApplicationContext['terms'] = null
    if (this.legalTermsService) {
      try {
        const currentTerms =
          await this.legalTermsService.getCurrentPublishedTerms()
        terms = {
          key: currentTerms.key,
          version: currentTerms.version,
          hash: currentTerms.contentHash,
          url: '/terms',
        }
      } catch {
        terms = null
      }
    }

    const base = {
      enabled: this.isFlowEnabled(),
      eligible: false,
      reasonCode: null as RentalApplicationContext['reasonCode'],
      listing: {
        ...listing,
        id: apartment._id?.toHexString() ?? apartmentId,
        landlordDisplayName: apartment.landlord?.fullName ?? null,
      },
      pricingRevision: apartment.pricingRevision ?? 0,
      packages: [],
      disclosure: {
        version: RENTAL_REVIEW_DISCLOSURE_VERSION,
        hash: buildRentalDisclosureHash(),
        items: RENTAL_REVIEW_DISCLOSURES,
      },
      terms,
    }

    if (!base.enabled) {
      return { ...base, reasonCode: 'RENTAL_FLOW_DISABLED' }
    }
    if (apartment.landlordId === tenantId) {
      return { ...base, reasonCode: 'OWNER_NOT_ELIGIBLE' }
    }
    if (
      apartment.status !== 'available' ||
      (apartment.rentalReservation !== null &&
        apartment.rentalReservation !== undefined)
    ) {
      return { ...base, reasonCode: 'LISTING_UNAVAILABLE' }
    }
    const packages = await Promise.all(
      this.getOfferedPackages(apartment).map(async packageItem => {
        const feeSnapshot = await this.platformFeesService?.quote({
          durationMonths: packageItem.durationMonths,
          monthlyRent: packageItem.monthlyRent,
        })
        return {
          ...packageItem,
          currency: 'VND' as const,
          feeSnapshot: feeSnapshot
            ? {
                ...feeSnapshot,
                quote: feeSnapshot.quote
                  .filter(line => line.payerRole === 'tenant')
                  .map(line => ({ ...line, payerRole: 'tenant' as const })),
              }
            : null,
        }
      })
    )
    if (packages.length === 0) {
      return { ...base, reasonCode: 'NO_ACTIVE_PACKAGE' }
    }

    let flowProfile: RentalApplicationContext['flowProfile'] = null
    if (this.flowConfigResolver) {
      try {
        const resolved = await this.flowConfigResolver.resolveProfile({
          durationMonths: packages[0]?.durationMonths,
          packageId: packages[0]?.packageId,
        })
        flowProfile = {
          profileId: resolved.profileId,
          name: resolved.name,
          version: resolved.version,
          hash: resolved.hash,
          precedence: resolved.precedence,
          steps: resolved.steps,
        }
      } catch (err) {
        this.logger.warn(
          `Failed to resolve flow profile in getContext: ${String(err)}`
        )
      }
    }

    return { ...base, eligible: true, packages, reasonCode: null, flowProfile }
  }

  async create(
    tenantId: string,
    dto: CreateRentalApplicationDto
  ): Promise<RentalApplication> {
    this.assertFlowEnabled()
    const apartment = await this.apartmentsService.findOne(dto.apartmentId)
    if (apartment.landlordId === tenantId) {
      throw new BadRequestException('Cannot apply to your own listing')
    }
    if (
      apartment.status !== 'available' ||
      (apartment.rentalReservation !== null &&
        apartment.rentalReservation !== undefined)
    ) {
      throw new ConflictException('LISTING_UNAVAILABLE')
    }
    const moveInDate = new Date(dto.moveInDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (moveInDate < today) {
      throw new BadRequestException('Move-in date must not be in the past')
    }
    const duplicate = await this.repository.findOne({
      where: { tenantId, apartmentId: dto.apartmentId, status: 'pending' },
    })
    if (duplicate) {
      throw new ConflictException('A pending application already exists')
    }

    const selectedPackage = this.resolveSelectedPackage(apartment, dto)
    if (
      dto.occupantsDetail &&
      dto.occupantsDetail.length + 1 !== dto.occupants
    ) {
      throw new BadRequestException('APPLICATION_OCCUPANTS_MISMATCH')
    }

    const selectedPaymentCycleMonths =
      dto.selectedPaymentCycleMonths ??
      selectedPackage.settlementPolicy?.defaultPaymentCycle ??
      1
    const allowedPaymentCycles = selectedPackage.settlementPolicy
      ?.allowedPaymentCycles ?? [1]
    if (!allowedPaymentCycles.includes(selectedPaymentCycleMonths)) {
      throw new BadRequestException('PAYMENT_CYCLE_NOT_ALLOWED')
    }

    const feeSnapshot = await this.platformFeesService?.quote({
      durationMonths: selectedPackage.durationMonths,
      monthlyRent: selectedPackage.monthlyRent,
    })
    const suppliedFeeQuote =
      dto.feeScheduleId !== undefined ||
      dto.feeScheduleVersion !== undefined ||
      dto.feeContentHash !== undefined
    if (
      (feeSnapshot &&
        (dto.feeScheduleId !== feeSnapshot.scheduleId ||
          dto.feeScheduleVersion !== feeSnapshot.version ||
          dto.feeContentHash !== feeSnapshot.contentHash)) ||
      (!feeSnapshot && suppliedFeeQuote)
    ) {
      throw new ConflictException('PLATFORM_FEE_QUOTE_STALE')
    }
    const tenantFee = feeSnapshot?.quote.find(
      line => line.payerRole === 'tenant'
    )
    if (
      tenantFee &&
      tenantFee.amount > 0 &&
      dto.feeAcknowledgedHash !== feeSnapshot?.contentHash
    ) {
      throw new UnprocessableEntityException('PLATFORM_FEE_ACK_REQUIRED')
    }

    if (dto.viewingBookingId) {
      if (!this.bookingsService || !ObjectId.isValid(dto.viewingBookingId)) {
        throw new BadRequestException('APPLICATION_VIEWING_INVALID')
      }
      try {
        const booking = await this.bookingsService.findOneById(
          dto.viewingBookingId
        )
        if (
          booking.tenantId !== tenantId ||
          booking.apartmentId !== dto.apartmentId ||
          !['confirmed', 'completed'].includes(booking.status)
        ) {
          throw new BadRequestException('APPLICATION_VIEWING_INVALID')
        }
      } catch (error: unknown) {
        if (error instanceof BadRequestException) throw error
        throw new BadRequestException('APPLICATION_VIEWING_INVALID')
      }
    }

    const executionPolicySnapshot = await this.resolveSelectedExecutionPolicy(
      selectedPackage,
      dto.selectedExecutionPolicy
    )
    const disclosureHash = buildRentalDisclosureHash()
    if (
      dto.disclosureVersion !== RENTAL_REVIEW_DISCLOSURE_VERSION ||
      !hasRequiredRentalDisclosures(dto.acknowledgedDisclosureIds)
    ) {
      throw new BadRequestException('RENTAL_REVIEW_ACKNOWLEDGEMENT_REQUIRED')
    }
    const capturedAt = new Date()
    const listingSnapshot = this.toListingSnapshot(apartment)
    const packageSnapshot: RentalPackageRecord = {
      ...selectedPackage,
      defaultExecutionPolicy: executionPolicySnapshot,
      currency: 'VND',
      capturedAt,
    }

    let termsRef:
      | { key: string; version: number; contentHash: string }
      | undefined = undefined
    let termsAcceptedAt: Date | undefined = undefined

    if (this.legalTermsService) {
      try {
        const currentTerms =
          await this.legalTermsService.getCurrentPublishedTerms()
        if (currentTerms) {
          if (
            dto.acceptedTermsVersion !== currentTerms.version ||
            dto.acceptedTermsHash !== currentTerms.contentHash
          ) {
            throw new ConflictException('TERMS_STALE')
          }
          termsRef = {
            key: currentTerms.key,
            version: currentTerms.version,
            contentHash: currentTerms.contentHash,
          }
          termsAcceptedAt = capturedAt
        }
      } catch (err) {
        if (err instanceof ConflictException) throw err
      }
    }

    let flowProfileRef:
      | { profileId: string; version: number; hash: string }
      | undefined = undefined
    if (this.flowConfigResolver) {
      try {
        const resolved = await this.flowConfigResolver.resolveProfile({
          durationMonths: selectedPackage.durationMonths,
          packageId: selectedPackage.packageId,
        })
        if (
          (dto.flowProfileVersion !== undefined &&
            dto.flowProfileVersion !== resolved.version) ||
          (dto.flowProfileHash !== undefined &&
            dto.flowProfileHash !== resolved.hash)
        ) {
          throw new ConflictException('FLOW_CONFIG_STALE')
        }

        if (resolved.steps?.step1) {
          const s1 = resolved.steps.step1
          const moveInDateNormalized = new Date(dto.moveInDate)
          moveInDateNormalized.setHours(0, 0, 0, 0)
          const diffMs = moveInDateNormalized.getTime() - today.getTime()
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

          if (
            s1.minMoveInLeadDays !== undefined &&
            diffDays < s1.minMoveInLeadDays
          ) {
            throw new BadRequestException(
              `Ngày vào ở phải sau hôm nay ít nhất ${s1.minMoveInLeadDays} ngày`
            )
          }
          if (
            s1.maxMoveInLeadDays !== undefined &&
            diffDays > s1.maxMoveInLeadDays
          ) {
            throw new BadRequestException(
              `Ngày vào ở không được vượt quá ${s1.maxMoveInLeadDays} ngày tính từ hôm nay`
            )
          }
          if (
            s1.minOccupants !== undefined &&
            dto.occupants < s1.minOccupants
          ) {
            throw new BadRequestException(
              `Số người ở tối thiểu là ${s1.minOccupants} người`
            )
          }
          if (
            s1.maxOccupants !== undefined &&
            dto.occupants > s1.maxOccupants
          ) {
            throw new BadRequestException(
              `Số người ở tối đa là ${s1.maxOccupants} người`
            )
          }
        }

        flowProfileRef = {
          profileId: resolved.profileId,
          version: resolved.version,
          hash: resolved.hash,
        }
      } catch (err) {
        if (
          err instanceof ConflictException ||
          err instanceof BadRequestException
        ) {
          throw err
        }
        this.logger.warn(
          `Failed to resolve flow profile in create: ${String(err)}`
        )
      }
    }

    const reviewSnapshot = {
      disclosureVersion: dto.disclosureVersion,
      disclosureHash,
      acknowledgedDisclosureIds: [...dto.acknowledgedDisclosureIds].sort(),
      acknowledgedAt: capturedAt,
      reviewHash: buildRentalReviewHash({
        listing: listingSnapshot,
        packageSnapshot,
        executionPolicySnapshot,
        disclosureVersion: dto.disclosureVersion,
        disclosureHash,
        acknowledgedDisclosureIds: dto.acknowledgedDisclosureIds,
        ...(termsRef ? { termsRef } : {}),
        ...(flowProfileRef ? { flowProfileRef } : {}),
      }),
      ...(termsRef ? { termsRef, termsAcceptedAt } : {}),
      ...(flowProfileRef ? { flowProfileRef } : {}),
    }

    const created = await this.repository.save(
      this.repository.create({
        tenantId,
        apartmentId: dto.apartmentId,
        landlordId: apartment.landlordId,
        packageId: selectedPackage.packageId,
        packageVersion: selectedPackage.version,
        packageSnapshot,
        executionPolicySnapshot,
        contractId: null,
        depositAgreementId: null,
        applicationRevision: 1,
        pricingRevision: apartment.pricingRevision ?? 0,
        listingSnapshot,
        reviewSnapshot,
        provisioningStatus: 'not-started',
        provisioningErrorCode: null,
        decisionIdempotencyKey: null,
        decisionNote: null,
        submittedAt: capturedAt,
        decidedAt: null,
        occupants: dto.occupants,
        occupantsDetail: dto.occupantsDetail ?? null,
        vehicles: dto.vehicles ?? null,
        emergencyContact: dto.emergencyContact ?? null,
        selectedPaymentCycleMonths,
        viewingBookingId: dto.viewingBookingId ?? null,
        feeSnapshot: feeSnapshot ?? null,
        tenantFeeAck:
          tenantFee && feeSnapshot
            ? {
                contentHash: feeSnapshot.contentHash,
                acknowledgedAt: capturedAt,
              }
            : null,
        moveInDate,
        leaseDurationMonths: selectedPackage.durationMonths,
        occupation: dto.occupation,
        hasPets: dto.hasPets,
        notes: dto.notes ?? null,
        status: 'pending',
        reasonCode: null,
        actorId: null,
        actorTimestamp: null,
      })
    )
    await this.recordTransactionEvent({
      applicationId: created._id.toHexString(),
      eventType: 'application.submitted',
      actorRole: 'tenant',
      actorId: tenantId,
      transitionKey: `application:${created._id.toHexString()}:submitted`,
    })
    return this.withContractHandoff(this.withFeeVisibility(created, 'tenant'))
  }

  async getMine(
    tenantId: string,
    query: RentalApplicationQueryDto
  ): Promise<RentalApplicationListResult> {
    return this.list({ tenantId }, query)
  }

  async getReceived(
    landlordId: string,
    query: RentalApplicationQueryDto
  ): Promise<RentalApplicationListResult> {
    if (this.ownershipTransferResolver) {
      const records = await this.repository.find({
        order: { updatedAt: 'DESC' },
      })
      const visible = await Promise.all(
        records.map(async application => {
          if (application.landlordId === landlordId) return true
          return this.ownershipTransferResolver?.canAccessProperty(
            landlordId,
            application.apartmentId,
            application.landlordId
          )
        })
      )
      return this.listRecords(
        records.filter((_application, index) => visible[index]),
        query,
        'landlord'
      )
    }
    return this.list({ landlordId }, query)
  }

  async getOne(
    id: string,
    actorId: string,
    isStaff = false
  ): Promise<RentalApplication> {
    const application = await this.findOrThrow(id)
    const canReadAsLandlord =
      application.landlordId === actorId ||
      (this.ownershipTransferResolver
        ? await this.ownershipTransferResolver.canAccessProperty(
            actorId,
            application.apartmentId,
            application.landlordId
          )
        : false)
    if (!isStaff && application.tenantId !== actorId && !canReadAsLandlord) {
      throw new ForbiddenException('APPLICATION_ACCESS_DENIED')
    }
    const role = isStaff ? 'staff' : canReadAsLandlord ? 'landlord' : 'tenant'
    const visible =
      canReadAsLandlord && !isStaff
        ? this.withMaskedEmergencyPhone(application)
        : application
    return this.withContractHandoff(this.withFeeVisibility(visible, role))
  }

  async retryProvisioning(
    id: string,
    actorId: string
  ): Promise<RentalApplication> {
    const application = await this.findOrThrow(id)
    if (application.status !== 'accepted') {
      throw new ConflictException('APPLICATION_NOT_ACCEPTED')
    }
    if (application.provisioningStatus === 'ready') {
      return this.withContractHandoff(application)
    }
    this.logger.log(`Retrying rental provisioning ${id} by staff ${actorId}`)
    const result = await this.provisionAcceptedApplication(application)
    return this.withContractHandoff(result)
  }

  async respond(
    id: string,
    landlordId: string,
    dto: RespondRentalApplicationDto
  ): Promise<RentalApplication> {
    const application = await this.findOrThrow(id)
    if (application.landlordId !== landlordId) {
      throw new ForbiddenException(
        'Application does not belong to current landlord'
      )
    }

    const expectedRevision =
      dto.expectedRevision ?? application.applicationRevision ?? 1
    if (
      application.status === 'accepted' &&
      application.decisionIdempotencyKey === dto.idempotencyKey &&
      application.provisioningStatus === 'ready'
    ) {
      return application
    }
    if (
      application.status === 'accepted' &&
      application.provisioningStatus === 'failed' &&
      dto.status === 'accepted'
    ) {
      return this.provisionAcceptedApplication(application)
    }
    if (application.status !== 'pending') {
      throw new ConflictException('Application has already been resolved')
    }
    if (expectedRevision !== (application.applicationRevision ?? 1)) {
      throw new ConflictException('APPLICATION_REVISION_STALE')
    }

    const landlordFee = application.feeSnapshot?.quote.find(
      line => line.payerRole === 'landlord'
    )
    if (
      dto.status === 'accepted' &&
      landlordFee &&
      landlordFee.amount > 0 &&
      dto.landlordFeeAck !== application.feeSnapshot?.contentHash
    ) {
      throw new UnprocessableEntityException('PLATFORM_FEE_ACK_REQUIRED')
    }
    if (dto.status === 'accepted' && landlordFee && application.feeSnapshot) {
      application.landlordFeeAck = {
        contentHash: application.feeSnapshot.contentHash,
        acknowledgedAt: new Date(),
      }
    }

    const decisionTimestamp = new Date()
    const decisionPatch = {
      status: dto.status,
      reasonCode: dto.reasonCode.trim().toUpperCase(),
      decisionNote: dto.note?.trim() || null,
      actorId: landlordId,
      actorTimestamp: decisionTimestamp,
      decidedAt: decisionTimestamp,
      decisionIdempotencyKey: dto.idempotencyKey ?? null,
      applicationRevision: expectedRevision + 1,
    } satisfies Partial<RentalApplication>

    const repositoryWithCas = this
      .repository as Repository<RentalApplication> & {
      update?: Repository<RentalApplication>['update']
    }
    if (typeof repositoryWithCas.update === 'function') {
      const result = await repositoryWithCas.update(
        {
          _id: application._id,
          status: 'pending',
          applicationRevision: expectedRevision,
        },
        decisionPatch
      )
      if (result.affected !== 1) {
        throw new ConflictException('APPLICATION_REVISION_STALE')
      }
      Object.assign(application, decisionPatch)
    } else {
      Object.assign(application, decisionPatch)
    }

    const savedDecision =
      typeof repositoryWithCas.update === 'function'
        ? application
        : await this.repository.save(application)
    await this.recordTransactionEvent({
      applicationId: savedDecision._id.toHexString(),
      eventType:
        dto.status === 'accepted'
          ? 'application.accepted'
          : 'application.rejected',
      actorRole: 'landlord',
      actorId: landlordId,
      reasonCode: savedDecision.reasonCode ?? null,
      transitionKey: `application:${savedDecision._id.toHexString()}:decided:${dto.status}`,
    })
    if (dto.status === 'rejected')
      return this.withFeeVisibility(savedDecision, 'landlord')
    const provisioned = await this.provisionAcceptedApplication(savedDecision)
    return this.withFeeVisibility(provisioned, 'landlord')
  }

  private async provisionAcceptedApplication(
    application: RentalApplication
  ): Promise<RentalApplication> {
    if (
      !this.depositAgreementsService ||
      !this.contractsService ||
      typeof this.apartmentsService.reserveRentalApplication !== 'function'
    ) {
      return application
    }
    try {
      const apartment = await this.apartmentsService.findOne(
        application.apartmentId
      )
      const reserved = await this.apartmentsService.reserveRentalApplication(
        application.apartmentId,
        application._id.toHexString()
      )
      if (!reserved && application.provisioningStatus !== 'ready') {
        throw new ConflictException('RENTAL_RESERVATION_CONFLICT')
      }
      if (!application.packageSnapshot) {
        throw new BadRequestException('APPLICATION_PACKAGE_SNAPSHOT_REQUIRED')
      }
      const depositAgreement =
        await this.depositAgreementsService.createFromApplicationSnapshot({
          applicationId: application._id.toHexString(),
          propertyId: application.apartmentId,
          tenantId: application.tenantId,
          landlordId: application.landlordId,
          packageSnapshot: application.packageSnapshot,
          executionPolicySnapshot: application.executionPolicySnapshot ?? null,
        })
      const contract = await this.contractsService.createDraftFromApplication({
        rentalApplicationId: application._id.toHexString(),
        depositAgreementId: depositAgreement._id.toHexString(),
        propertyId: application.apartmentId,
        propertyTitle: apartment.title,
        propertyAddress: apartment.address ?? null,
        propertyArea: apartment.area ?? null,
        propertyFurniture: apartment.furniture ?? null,
        landlordId: application.landlordId,
        tenantId: application.tenantId,
        moveInDate: application.moveInDate,
        packageSnapshot: application.packageSnapshot,
        paymentCycleMonths: application.selectedPaymentCycleMonths ?? 1,
        feeSnapshot: application.feeSnapshot ?? null,
        executionPolicySnapshot: application.executionPolicySnapshot ?? null,
        applicationReviewHash: application.reviewSnapshot?.reviewHash ?? null,
        termsRef: application.reviewSnapshot?.termsRef ?? null,
        flowProfileRef: application.reviewSnapshot?.flowProfileRef ?? null,
      })
      application.depositAgreementId = depositAgreement._id.toHexString()
      application.contractId = contract._id.toHexString()
      application.provisioningStatus = 'ready'
      application.provisioningErrorCode = null
      const saved = await this.repository.save(application)
      await this.recordTransactionEvent({
        applicationId: saved._id.toHexString(),
        contractId: saved.contractId ?? null,
        eventType: 'application.provisioned',
        actorRole: 'system',
        refs: {
          applicationId: saved._id.toHexString(),
          ...(saved.depositAgreementId
            ? { depositAgreementId: saved.depositAgreementId }
            : {}),
        },
        transitionKey: `application:${saved._id.toHexString()}:provisioning:ready`,
      })
      if (this.notificationsService) {
        try {
          await this.notificationsService.createNotification(
            application.tenantId,
            'Yêu cầu thuê đã được chấp thuận',
            'Hồ sơ thuê đã được chấp thuận và đang chờ bước xác nhận cọc.',
            'rental-application-accepted',
            { applicationId: application._id.toHexString() }
          )
        } catch (error: unknown) {
          this.logger.warn(
            `Rental acceptance notification failed: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      return saved
    } catch (error: unknown) {
      application.provisioningStatus = 'failed'
      application.provisioningErrorCode =
        error instanceof Error
          ? error.message.slice(0, 120)
          : 'PROVISIONING_FAILED'
      await this.repository.save(application)
      await this.recordTransactionEvent({
        applicationId: application._id.toHexString(),
        eventType: 'application.provisioning-failed',
        actorRole: 'system',
        reasonCode: application.provisioningErrorCode ?? null,
        transitionKey: `application:${application._id.toHexString()}:provisioning:failed`,
      })
      throw error
    }
  }

  private async recordTransactionEvent(input: {
    applicationId: string
    contractId?: string | null
    eventType: string
    actorRole: 'tenant' | 'landlord' | 'staff' | 'admin' | 'system' | 'provider'
    actorId?: string | null
    reasonCode?: string | null
    refs?: Record<string, string>
    transitionKey: string
  }): Promise<void> {
    if (!this.transactionEventService) return
    try {
      await this.transactionEventService.record({
        transactionKey: input.applicationId,
        applicationId: input.applicationId,
        contractId: input.contractId ?? null,
        eventType: input.eventType,
        actorRole: input.actorRole,
        actorId: input.actorId ?? null,
        reasonCode: input.reasonCode ?? null,
        refs: { applicationId: input.applicationId, ...(input.refs ?? {}) },
        transitionKey: input.transitionKey,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        `Rental transaction audit failed for application [${input.applicationId}] event [${input.eventType}]: ${message}`
      )
    }
  }

  private resolveSelectedPackage(
    apartment: Awaited<ReturnType<ApartmentsService['findOne']>>,
    dto: CreateRentalApplicationDto
  ): RentalPackageRecord {
    const selectedPackage = this.getOfferedPackages(apartment).find(
      packageItem =>
        packageItem.packageId === dto.packageId &&
        packageItem.version === dto.packageVersion
    )
    if (!selectedPackage) throw new ConflictException('PACKAGE_STALE')
    return selectedPackage
  }

  private async resolveSelectedExecutionPolicy(
    selectedPackage: RentalPackageRecord,
    requested?: RentalExecutionPolicyRef
  ): Promise<RentalExecutionPolicyRef> {
    const allowed = selectedPackage.allowedExecutionPolicies?.length
      ? selectedPackage.allowedExecutionPolicies
      : [
          selectedPackage.defaultExecutionPolicy ??
            getDefaultRentalExecutionPolicyRef(),
        ]
    const selected =
      requested ?? selectedPackage.defaultExecutionPolicy ?? allowed[0]
    if (!selected) {
      throw new ConflictException('RENTAL_EXECUTION_POLICY_SELECTION_REQUIRED')
    }
    if (
      !allowed.some(
        ref =>
          ref.policyId === selected.policyId &&
          ref.version === selected.version &&
          ref.strategy === selected.strategy &&
          ref.contentHash === selected.contentHash
      )
    ) {
      throw new ConflictException('RENTAL_EXECUTION_POLICY_INVALID')
    }
    if (allowed.length > 1 && !requested) {
      throw new ConflictException('RENTAL_EXECUTION_POLICY_SELECTION_REQUIRED')
    }
    if (this.executionPoliciesService) {
      await this.executionPoliciesService.resolvePublishedRef(selected)
    }
    return { ...selected }
  }

  /** [PROP-321] [uc_customer_contract] Keeps available legacy listings rentable. */
  private getOfferedPackages(
    apartment: Awaited<ReturnType<ApartmentsService['findOne']>>
  ): RentalPackageRecord[] {
    const configuredPackages = (apartment.rentalPackages ?? []).filter(
      packageItem => packageItem.status === 'active'
    )
    if (configuredPackages.length > 0) return configuredPackages

    if (
      !Number.isInteger(apartment.priceMonthly) ||
      apartment.priceMonthly <= 0
    ) {
      return []
    }

    return [
      {
        packageId: COMPATIBILITY_PACKAGE_ID,
        version: COMPATIBILITY_PACKAGE_VERSION,
        durationMonths: 12,
        monthlyRent: apartment.priceMonthly,
        depositPolicy: { type: 'MONTHS_OF_RENT', months: 1 },
        resolvedDepositAmount: apartment.priceMonthly,
        status: 'active',
        defaultExecutionPolicy: getDefaultRentalExecutionPolicyRef(),
        allowedExecutionPolicies: [getDefaultRentalExecutionPolicyRef()],
      },
    ]
  }

  private async list(
    where: { tenantId?: string; landlordId?: string },
    query: RentalApplicationQueryDto
  ): Promise<RentalApplicationListResult> {
    const records = await this.repository.find({
      where,
      order: { updatedAt: 'DESC' },
    })
    return this.listRecords(
      records,
      query,
      where.landlordId ? 'landlord' : 'tenant'
    )
  }

  private listRecords(
    records: RentalApplication[],
    query: RentalApplicationQueryDto,
    role: 'tenant' | 'landlord' | 'staff' = 'staff'
  ): RentalApplicationListResult {
    const filtered = query.status
      ? records.filter(item => item.status === query.status)
      : records
    const start = (query.page - 1) * query.limit
    return {
      items: filtered
        .slice(start, start + query.limit)
        .map(application =>
          this.withContractHandoff(
            this.withFeeVisibility(
              role === 'landlord'
                ? this.withMaskedEmergencyPhone(application)
                : application,
              role
            )
          )
        ),
      total: filtered.length,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(filtered.length / query.limit),
    }
  }

  private withFeeVisibility(
    application: RentalApplication,
    role: 'tenant' | 'landlord' | 'staff'
  ): RentalApplication {
    if (!application.feeSnapshot || role === 'staff') return application
    return {
      ...application,
      feeSnapshot: {
        ...application.feeSnapshot,
        quote: application.feeSnapshot.quote.filter(
          line => line.payerRole === role
        ),
      },
    }
  }

  private async findOrThrow(id: string): Promise<RentalApplication> {
    if (!ObjectId.isValid(id)) {
      throw new NotFoundException('Rental application not found')
    }
    const application = await this.repository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!application) {
      throw new NotFoundException('Rental application not found')
    }
    return application
  }

  private withContractHandoff(
    application: RentalApplication
  ): RentalApplication {
    const handoff: ContractHandoff =
      application.status === 'rejected'
        ? {
            state: 'rejected',
            contractId: null,
            href: null,
            reasonCode: application.reasonCode,
          }
        : application.status === 'pending'
          ? {
              state: 'pending',
              contractId: null,
              href: null,
              reasonCode: null,
            }
          : application.provisioningStatus === 'ready' && application.contractId
            ? {
                state: 'ready',
                contractId: application.contractId,
                href: `/contracts/${application.contractId}`,
                reasonCode: null,
              }
            : application.provisioningStatus === 'failed'
              ? {
                  state: 'failed',
                  contractId: application.contractId ?? null,
                  href: null,
                  reasonCode:
                    application.provisioningErrorCode ?? 'PROVISIONING_FAILED',
                }
              : {
                  state: 'provisioning',
                  contractId: application.contractId ?? null,
                  href: null,
                  reasonCode: null,
                }
    return Object.assign(application, { contractHandoff: handoff })
  }

  private withMaskedEmergencyPhone(
    application: RentalApplication
  ): RentalApplication {
    const emergencyContact = application.emergencyContact
    if (!emergencyContact) return application

    const phone = emergencyContact.phone
    const visiblePrefixLength = Math.min(3, Math.max(phone.length - 2, 0))
    const maskedPhone = `${phone.slice(0, visiblePrefixLength)}${'*'.repeat(
      Math.max(phone.length - visiblePrefixLength - 2, 0)
    )}${phone.slice(-2)}`

    return {
      ...application,
      emergencyContact: { ...emergencyContact, phone: maskedPhone },
    }
  }

  private toListingSnapshot(
    apartment: Awaited<ReturnType<ApartmentsService['findOne']>>
  ): RentalApplicationListingSnapshot {
    return {
      title: apartment.title,
      address: apartment.address ?? apartment.location ?? '',
      area: apartment.area,
      status: apartment.status,
      capturedAt: new Date(),
    }
  }

  private isFlowEnabled(): boolean {
    return this.configService?.get<boolean>('rentalFlow.enabled') ?? true
  }

  private assertFlowEnabled(): void {
    if (!this.isFlowEnabled()) {
      throw new ConflictException('RENTAL_FLOW_DISABLED')
    }
  }
}
