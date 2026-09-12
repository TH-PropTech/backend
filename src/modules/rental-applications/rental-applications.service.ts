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
import { ApartmentsService } from '../apartments/apartments.service'
import type { RentalPackageRecord } from '../apartments/rental-package.util'
import { ContractsService } from '../contracts/contracts.service'
import { DepositAgreementsService } from '../contracts/deposit-agreements.service'
import { NotificationsService } from '../notifications/notifications.service'
import { CreateRentalApplicationDto } from './dto/create-rental-application.dto'
import type { RentalApplicationContext } from './dto/rental-application-context.dto'
import { RentalApplicationQueryDto } from './dto/rental-application-query.dto'
import { RespondRentalApplicationDto } from './dto/respond-rental-application.dto'
import {
  buildRentalDisclosureHash,
  buildRentalReviewHash,
  hasRequiredRentalDisclosures,
  RENTAL_REVIEW_DISCLOSURES,
  RENTAL_REVIEW_DISCLOSURE_VERSION,
  type RentalApplicationListingSnapshot,
} from './rental-application-review.util'
import { RentalApplication } from './schemas/rental-application.schema'

export interface RentalApplicationListResult {
  items: RentalApplication[]
  total: number
  page: number
  limit: number
  totalPages: number
}

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
    @Optional() private readonly notificationsService?: NotificationsService
  ) {}

  async getContext(
    tenantId: string,
    apartmentId: string
  ): Promise<RentalApplicationContext> {
    const apartment = await this.apartmentsService.findOne(apartmentId)
    const listing = this.toListingSnapshot(apartment)
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
    if (apartment.pricingMode !== 'packages') {
      return { ...base, reasonCode: 'LEGACY_PRICING' }
    }

    const packages = (apartment.rentalPackages ?? [])
      .filter(packageItem => packageItem.status === 'active')
      .map(packageItem => ({ ...packageItem, currency: 'VND' as const }))
    if (packages.length === 0) {
      return { ...base, reasonCode: 'NO_ACTIVE_PACKAGE' }
    }
    return { ...base, eligible: true, packages, reasonCode: null }
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
      currency: 'VND',
      capturedAt,
    }
    const reviewSnapshot = {
      disclosureVersion: dto.disclosureVersion,
      disclosureHash,
      acknowledgedDisclosureIds: [...dto.acknowledgedDisclosureIds].sort(),
      acknowledgedAt: capturedAt,
      reviewHash: buildRentalReviewHash({
        listing: listingSnapshot,
        packageSnapshot,
        disclosureVersion: dto.disclosureVersion,
        disclosureHash,
        acknowledgedDisclosureIds: dto.acknowledgedDisclosureIds,
      }),
    }

    return this.repository.save(
      this.repository.create({
        tenantId,
        apartmentId: dto.apartmentId,
        landlordId: apartment.landlordId,
        packageId: selectedPackage.packageId,
        packageVersion: selectedPackage.version,
        packageSnapshot,
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
    return this.list({ landlordId }, query)
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
    if (application.status !== 'pending') {
      throw new ConflictException('Application has already been resolved')
    }
    if (expectedRevision !== (application.applicationRevision ?? 1)) {
      throw new ConflictException('APPLICATION_REVISION_STALE')
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
    if (dto.status === 'rejected') return savedDecision
    return this.provisionAcceptedApplication(savedDecision)
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
          tenantId: application.tenantId,
          landlordId: application.landlordId,
          packageSnapshot: application.packageSnapshot,
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
      })
      application.depositAgreementId = depositAgreement._id.toHexString()
      application.contractId = contract._id.toHexString()
      application.provisioningStatus = 'ready'
      application.provisioningErrorCode = null
      const saved = await this.repository.save(application)
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
      throw error
    }
  }

  private resolveSelectedPackage(
    apartment: Awaited<ReturnType<ApartmentsService['findOne']>>,
    dto: CreateRentalApplicationDto
  ): RentalPackageRecord {
    if (apartment.pricingMode !== 'packages') {
      throw new ConflictException('LEGACY_PRICING')
    }
    const selectedPackage = (apartment.rentalPackages ?? []).find(
      packageItem =>
        packageItem.packageId === dto.packageId &&
        packageItem.version === dto.packageVersion &&
        packageItem.status === 'active'
    )
    if (!selectedPackage) throw new ConflictException('PACKAGE_STALE')
    return selectedPackage
  }

  private async list(
    where: { tenantId?: string; landlordId?: string },
    query: RentalApplicationQueryDto
  ): Promise<RentalApplicationListResult> {
    const records = await this.repository.find({
      where,
      order: { updatedAt: 'DESC' },
    })
    const filtered = query.status
      ? records.filter(item => item.status === query.status)
      : records
    const start = (query.page - 1) * query.limit
    return {
      items: filtered.slice(start, start + query.limit),
      total: filtered.length,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(filtered.length / query.limit),
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
