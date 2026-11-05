import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { FindOperator, FindOptionsWhere, Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Apartment } from '../schemas/apartment.schema'
import { User } from '../../users/schemas/user.schema'
import { ApartmentFilterDto } from '../dto/apartment-filter.dto'
import { ApartmentChangeNotifier } from '../../read-model/services/apartment-change-notifier.service'
import { buildApartmentQuery } from '../utils/apartment-query.builder'
import {
  attachCurrentLandlords,
  type ApartmentWithLandlord,
} from '../utils/attach-landlords'
import {
  CreateApartmentDto,
  UpdateRentalPackagesDto,
} from '../dto/create-apartment.dto'
import { UpdateApartmentDto } from '../dto/update-apartment.dto'
import {
  validateRentalPackages as validateRentalPackageInputs,
  type HoldingDepositInput,
  type RentalPackageInput,
  type PrepaidRentInput,
  type SettlementPolicyInput,
} from '../utils/rental-package.util'
import { UpdateApartmentMediaDto } from '../dto/update-apartment-media.dto'
import { NotificationsService } from '../../notifications/services/notifications.service'
import { recordPriceChange } from '../utils/price-history.util'
import { ProjectsService } from './projects.service'
import { SavedSearchesService } from './saved-searches.service'
import { RentalExecutionPoliciesService } from '../../rental/services/rental-execution-policies.service'

function toRentalPackageInputs(
  packages: CreateApartmentDto['rentalPackages']
): RentalPackageInput[] {
  if (!packages) return []

  return packages.map(packageItem => {
    const policy = packageItem.depositPolicy
    const settlementPolicy = packageItem.settlementPolicy
    let depositPolicy: RentalPackageInput['depositPolicy']
    if (policy.type === 'MONTHS_OF_RENT') {
      if (policy.months === undefined) {
        throw new BadRequestException(
          'INVALID_RENTAL_PACKAGE: deposit policy value is required'
        )
      }
      depositPolicy = { type: policy.type, months: policy.months }
    } else {
      if (policy.amount === undefined) {
        throw new BadRequestException(
          'INVALID_RENTAL_PACKAGE: deposit policy value is required'
        )
      }
      depositPolicy = { type: policy.type, amount: policy.amount }
    }

    let normalizedSettlementPolicy: SettlementPolicyInput | undefined
    if (settlementPolicy) {
      let holdingDeposit: HoldingDepositInput | undefined
      if (settlementPolicy.holdingDeposit?.type === 'FIXED_AMOUNT') {
        if (settlementPolicy.holdingDeposit.amount === undefined) {
          throw new BadRequestException('HOLDING_DEPOSIT_INVALID')
        }
        holdingDeposit = {
          type: 'FIXED_AMOUNT',
          amount: settlementPolicy.holdingDeposit.amount,
        }
      } else if (
        settlementPolicy.holdingDeposit?.type === 'PERCENT_OF_SECURITY'
      ) {
        if (settlementPolicy.holdingDeposit.percent === undefined) {
          throw new BadRequestException('HOLDING_DEPOSIT_INVALID')
        }
        holdingDeposit = {
          type: 'PERCENT_OF_SECURITY',
          percent: settlementPolicy.holdingDeposit.percent,
        }
      }
      normalizedSettlementPolicy = {
        ...(holdingDeposit ? { holdingDeposit } : {}),
        allowedPaymentCycles: settlementPolicy.allowedPaymentCycles,
        defaultPaymentCycle: settlementPolicy.defaultPaymentCycle,
        firstPaymentDueOffsetDays: settlementPolicy.firstPaymentDueOffsetDays,
      }
    }

    let prepaidRent: PrepaidRentInput | undefined
    if (packageItem.prepaidRent) {
      const raw = packageItem.prepaidRent
      if (raw.type === 'MONTHS') {
        if (raw.months === undefined) {
          throw new BadRequestException(
            'INVALID_RENTAL_PACKAGE: prepaid rent months is required'
          )
        }
        prepaidRent = { type: 'MONTHS', months: raw.months }
      } else {
        prepaidRent = { type: raw.type }
      }
    }

    return {
      packageId: packageItem.packageId,
      version: packageItem.version,
      durationMonths: packageItem.durationMonths,
      monthlyRent: packageItem.monthlyRent,
      depositPolicy,
      status: packageItem.status ?? 'active',
      ...(normalizedSettlementPolicy
        ? { settlementPolicy: normalizedSettlementPolicy }
        : {}),
      ...(prepaidRent ? { prepaidRent } : {}),
      ...(packageItem.paymentDay !== undefined
        ? { paymentDay: packageItem.paymentDay }
        : {}),
      ...(packageItem.latePenaltyRate !== undefined
        ? { latePenaltyRate: packageItem.latePenaltyRate }
        : {}),
      ...(packageItem.terminationNoticeDays !== undefined
        ? { terminationNoticeDays: packageItem.terminationNoticeDays }
        : {}),
      ...(packageItem.customClauses
        ? { customClauses: packageItem.customClauses }
        : {}),
      ...(packageItem.moveOutPolicy
        ? {
            moveOutPolicy: {
              responseDays: packageItem.moveOutPolicy.responseDays,
            },
          }
        : {}),
      ...(packageItem.allowedExecutionPolicies
        ? { allowedExecutionPolicies: packageItem.allowedExecutionPolicies }
        : {}),
      ...(packageItem.defaultExecutionPolicy
        ? { defaultExecutionPolicy: packageItem.defaultExecutionPolicy }
        : {}),
    }
  })
}

function validateRentalPackages(
  packages: RentalPackageInput[]
): ReturnType<typeof validateRentalPackageInputs> {
  try {
    return validateRentalPackageInputs(packages)
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new BadRequestException(error.message)
    }
    throw error
  }
}

const LISTING_VALIDITY_DAYS = 30
const EXPIRY_REMINDER_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

/** Mongo range operator; TypeORM's typed operators do not cover $gt/$lte on Mongo. */
function mongoDateRange(range: { $gt?: Date; $lte: Date }): FindOperator<Date> {
  return range as unknown as FindOperator<Date>
}

const ADDRESS_PART_KEYS = ['street', 'ward', 'district', 'city'] as const

/** Địa chỉ đầy đủ: dùng giá trị client gửi, nếu trống thì ghép từ đường, phường, quận, thành phố. */
function resolveLocation(
  dto: Pick<
    CreateApartmentDto,
    'location' | 'street' | 'ward' | 'district' | 'city'
  >
): string {
  return (
    dto.location?.trim() ||
    [dto.street, dto.ward, dto.district, dto.city].filter(Boolean).join(', ')
  )
}

function definedEntries<T extends object>(source: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined)
  ) as Partial<T>
}

@Injectable()
export class ApartmentsService {
  private readonly logger = new Logger(ApartmentsService.name)

  constructor(
    @InjectRepository(Apartment)
    private readonly apartmentRepository: Repository<Apartment>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly projectsService: ProjectsService,
    private readonly savedSearchesService: SavedSearchesService,
    @Optional()
    private readonly executionPoliciesService?: RentalExecutionPoliciesService,
    @Optional()
    private readonly apartmentChangeNotifier?: ApartmentChangeNotifier
  ) {}

  /** Mọi thao tác ghi căn hộ đi qua đây để phía đọc (cache) biết dữ liệu đã đổi. */
  private async saveAndNotify(apartment: Apartment): Promise<Apartment> {
    const saved = await this.apartmentRepository.save(apartment)
    await this.apartmentChangeNotifier?.changed(saved._id?.toString())
    return saved
  }

  // ── Đánh dấu hết hạn các bài đã quá expiresAt và báo chủ nhà ──
  async checkExpiration(): Promise<void> {
    const expiredApartments = await this.apartmentRepository.find({
      where: {
        status: 'available',
        expiresAt: mongoDateRange({ $lte: new Date() }),
      },
    })

    if (expiredApartments.length === 0) return
    this.logger.log(
      `Found ${expiredApartments.length} expired listings. Expiring them...`
    )
    for (const apt of expiredApartments) {
      apt.status = 'expired'
      const saved = await this.saveAndNotify(apt)
      await this.notifyLandlord(
        saved,
        'Bài đăng đã hết hạn',
        `Bài đăng "${saved.title}" đã hết hạn, nhấn Gia hạn để tiếp tục.`,
        'listing-expired'
      )
    }
  }

  // ── Nhắc chủ nhà các bài sắp hết hạn trong 3 ngày ──
  // Cửa sổ (now+2d, now+3d] rộng đúng 1 ngày: chạy mỗi ngày một lần thì mỗi bài chỉ được nhắc một lần.
  async remindExpiringSoon(): Promise<void> {
    const now = Date.now()
    const expiringApartments = await this.apartmentRepository.find({
      where: {
        status: 'available',
        expiresAt: mongoDateRange({
          $gt: new Date(now + (EXPIRY_REMINDER_DAYS - 1) * DAY_MS),
          $lte: new Date(now + EXPIRY_REMINDER_DAYS * DAY_MS),
        }),
      },
    })

    for (const apt of expiringApartments) {
      await this.notifyLandlord(
        apt,
        'Bài đăng sắp hết hạn',
        `Bài đăng "${apt.title}" sẽ hết hạn trong ${EXPIRY_REMINDER_DAYS} ngày.`,
        'listing-expiring'
      )
    }
  }

  private async notifyLandlord(
    apartment: Apartment,
    title: string,
    body: string,
    type: string
  ): Promise<void> {
    try {
      await this.notificationsService.createNotification(
        apartment.landlordId,
        title,
        body,
        type,
        { apartmentId: apartment._id.toString() }
      )
    } catch (err) {
      this.logger.error(`Error sending landlord ${type} notification:`, err)
    }
  }

  // ── Lấy toàn bộ danh sách căn hộ kèm bộ lọc ──
  async findAll(
    filters?: ApartmentFilterDto
  ): Promise<ApartmentWithLandlord[]> {
    this.logger.log(
      `Fetching apartments with filters: ${JSON.stringify(filters)}`
    )
    const query = buildApartmentQuery(filters)
    const apartments = await this.apartmentRepository.find({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      where: query as any,
      order: { createdAt: 'DESC' },
    })

    return this.attachCurrentLandlords(apartments)
  }

  // ── Lấy chi tiết căn hộ theo ID ──
  async findOne(id: string): Promise<Apartment & { landlord?: User | null }> {
    this.logger.log(`Fetching apartment details for ID: ${id}`)
    try {
      let apartment: Apartment | null = null
      if (ObjectId.isValid(id)) {
        apartment = await this.apartmentRepository.findOne({
          where: { _id: new ObjectId(id) },
        })
      }
      if (!apartment) {
        const allApartments = await this.apartmentRepository.find()
        apartment =
          allApartments.find(
            a =>
              a.title.toLowerCase().includes(id.toLowerCase()) ||
              id.toLowerCase().includes(a.title.toLowerCase())
          ) ?? null
      }
      if (!apartment) {
        throw new NotFoundException(`Không tìm thấy căn hộ với ID: ${id}`)
      }

      let landlord: User | null = null
      if (apartment.landlordId) {
        try {
          landlord = await this.userRepository.findOne({
            where: { _id: new ObjectId(apartment.landlordId) },
          })
        } catch (err) {
          this.logger.warn(
            `Failed to fetch landlord: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }

      return {
        ...apartment,
        landlord,
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error
      }
      throw new NotFoundException(
        `ID căn hộ không hợp lệ hoặc không tìm thấy: ${id}`
      )
    }
  }

  async reserveRentalApplication(
    apartmentId: string,
    applicationId: string
  ): Promise<boolean> {
    if (!ObjectId.isValid(apartmentId)) {
      throw new NotFoundException('RENTAL_PROPERTY_NOT_FOUND')
    }

    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(apartmentId) },
    })

    if (!apartment) {
      throw new NotFoundException('RENTAL_PROPERTY_NOT_FOUND')
    }

    if (apartment.status !== 'available') {
      return false
    }

    const existing = apartment.rentalReservation
    if (existing && existing.applicationId !== applicationId) {
      return false
    }

    if (
      existing &&
      existing.applicationId === applicationId &&
      existing.mode === 'application-accepted'
    ) {
      return true
    }

    const reservation = {
      applicationId,
      reservedAt: existing?.reservedAt ?? new Date(),
      mode: 'application-accepted',
      revision: existing?.revision ?? 1,
      acceptedAt: existing?.acceptedAt ?? new Date(),
    } satisfies NonNullable<Apartment['rentalReservation']>

    const repositoryWithCas = this
      .apartmentRepository as Repository<Apartment> & {
      update?: Repository<Apartment>['update']
    }
    if (typeof repositoryWithCas.update === 'function') {
      const availableWithoutReservation = {
        _id: apartment._id,
        status: 'available',
        rentalReservation: null,
      } as unknown as FindOptionsWhere<Apartment>
      const result = await repositoryWithCas.update(
        availableWithoutReservation,
        { rentalReservation: reservation }
      )
      if (result.affected === 1) {
        apartment.rentalReservation = reservation
        return true
      }

      const current = await this.apartmentRepository.findOne({
        where: { _id: apartment._id },
      })
      return (
        current?.status === 'available' &&
        current.rentalReservation?.applicationId === applicationId &&
        current.rentalReservation.mode === 'application-accepted'
      )
    }

    apartment.rentalReservation = reservation
    await this.saveAndNotify(apartment)
    return true
  }

  async markRentalDepositPaid(
    apartmentId: string,
    applicationId: string,
    depositAgreementId: string
  ): Promise<boolean> {
    if (!ObjectId.isValid(apartmentId)) return false
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(apartmentId) },
    })
    const reservation = apartment?.rentalReservation
    if (
      !apartment ||
      !reservation ||
      reservation.applicationId !== applicationId
    ) {
      return false
    }
    if (
      reservation.mode === 'deposit-paid' &&
      reservation.depositAgreementId === depositAgreementId
    ) {
      return true
    }
    if (reservation.mode === 'deposit-paid' || reservation.contractId) {
      return false
    }
    reservation.mode = 'deposit-paid'
    reservation.revision = (reservation.revision ?? 1) + 1
    reservation.depositAgreementId = depositAgreementId
    reservation.depositPaidAt = new Date()
    await this.saveAndNotify(apartment)
    return true
  }

  async markRentalLeaseActive(
    apartmentId: string,
    applicationId: string,
    contractId: string
  ): Promise<boolean> {
    if (!ObjectId.isValid(apartmentId)) return false
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(apartmentId) },
    })
    const reservation = apartment?.rentalReservation
    if (
      !apartment ||
      !reservation ||
      reservation.applicationId !== applicationId
    ) {
      return false
    }
    if (reservation.contractId) return reservation.contractId === contractId
    reservation.revision = (reservation.revision ?? 1) + 1
    reservation.contractId = contractId
    reservation.leaseActivatedAt = new Date()
    apartment.status = 'rented'
    await this.saveAndNotify(apartment)
    return true
  }

  async releaseRentalReservation(
    apartmentId: string,
    applicationId: string,
    expectedRevision?: number
  ): Promise<boolean> {
    if (!ObjectId.isValid(apartmentId)) return false
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(apartmentId) },
    })
    const reservation = apartment?.rentalReservation
    if (
      !apartment ||
      !reservation ||
      reservation.applicationId !== applicationId ||
      reservation.contractId ||
      (expectedRevision !== undefined &&
        (reservation.revision ?? 1) !== expectedRevision)
    ) {
      return false
    }

    const repositoryWithCas = this
      .apartmentRepository as Repository<Apartment> & {
      update?: Repository<Apartment>['update']
    }
    if (
      typeof repositoryWithCas.update === 'function' &&
      reservation.revision !== undefined
    ) {
      const result = await repositoryWithCas.update(
        {
          _id: apartment._id,
          'rentalReservation.applicationId': applicationId,
          'rentalReservation.revision':
            expectedRevision ?? reservation.revision,
          'rentalReservation.contractId': null,
        } as unknown as FindOptionsWhere<Apartment>,
        { rentalReservation: null }
      )
      if (result.affected !== 1) return false
      apartment.rentalReservation = null
      return true
    }

    apartment.rentalReservation = null
    await this.saveAndNotify(apartment)
    return true
  }

  // ── Lấy danh sách căn hộ của một chủ nhà ──
  async findByLandlord(landlordId: string): Promise<ApartmentWithLandlord[]> {
    this.logger.log(`Fetching apartments for landlord: ${landlordId}`)
    const apartments = await this.apartmentRepository.find({
      where: { landlordId },
      order: { createdAt: 'DESC' },
    })
    return this.attachCurrentLandlords(apartments)
  }

  // ── Lấy danh sách bài đăng chờ duyệt (cho Staff/Admin) ──
  async findPending(): Promise<ApartmentWithLandlord[]> {
    this.logger.log('Fetching pending apartment listings for staff review')
    const apartments = await this.apartmentRepository.find({
      where: { status: 'pending' },
      order: { createdAt: 'ASC' }, // FIFO — bài cũ nhất duyệt trước
    })
    return this.attachCurrentLandlords(apartments)
  }

  private attachCurrentLandlords(
    apartments: readonly Apartment[]
  ): Promise<ApartmentWithLandlord[]> {
    return attachCurrentLandlords(this.userRepository, apartments)
  }

  // ── Toàn bộ tin đăng mọi trạng thái kèm thông tin chủ nhà (màn quản lý của Staff/Admin) ──
  async findAllForStaff(): Promise<
    Array<Apartment & { landlord: User | null }>
  > {
    const apartments = await this.apartmentRepository.find({
      order: { createdAt: 'DESC' },
    })
    const landlordIds = [
      ...new Set(apartments.map(apartment => apartment.landlordId)),
    ].filter(id => ObjectId.isValid(id))

    const landlords =
      landlordIds.length === 0
        ? []
        : await this.userRepository.find({
            where: {
              _id: { $in: landlordIds.map(id => new ObjectId(id)) },
            } as unknown as Record<string, unknown>,
          })
    const landlordById = new Map(
      landlords.map(landlord => [landlord._id.toString(), landlord])
    )

    return apartments.map(apartment => ({
      ...apartment,
      landlord: landlordById.get(apartment.landlordId) ?? null,
    }))
  }

  // ── Lấy danh sách bài đăng đã bị từ chối (cho Staff/Admin) ──
  async findRejected(): Promise<Apartment[]> {
    this.logger.log('Fetching rejected apartment listings for staff review')
    return this.apartmentRepository.find({
      where: { status: 'rejected' },
      order: { createdAt: 'DESC' },
    })
  }

  // ── Cập nhật trạng thái kiểm duyệt căn hộ ──
  async updateStatus(
    id: string,
    status: 'available' | 'pending' | 'updating' | 'unavailable',
    isVerified?: boolean
  ): Promise<Apartment> {
    this.logger.log(`Updating status of apartment ${id} to ${status}`)
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!apartment) {
      throw new NotFoundException(`Không tìm thấy căn hộ với ID: ${id}`)
    }
    const previousStatus = apartment.status
    apartment.status = status
    if (isVerified !== undefined) {
      apartment.isVerified = isVerified
    } else if (status === 'available') {
      apartment.isVerified = true
    } else {
      apartment.isVerified = false
    }
    const saved = await this.saveAndNotify(apartment)
    await this.publishSearchAlerts(saved, 'status_change', {
      previousValue: previousStatus,
      newValue: saved.status,
    })
    return saved
  }

  async updatePrice(
    id: string,
    priceMonthly: number,
    landlordId: string
  ): Promise<Apartment> {
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!apartment) {
      throw new NotFoundException(`Không tìm thấy căn hộ với ID: ${id}`)
    }
    if (apartment.landlordId !== landlordId) {
      throw new ForbiddenException(
        'Bạn không có quyền cập nhật giá tin đăng này'
      )
    }

    const previousPrice = apartment.priceMonthly
    recordPriceChange(apartment, priceMonthly)
    const saved = await this.saveAndNotify(apartment)
    await this.publishSearchAlerts(saved, 'price_change', {
      previousValue: String(previousPrice),
      newValue: String(saved.priceMonthly),
    })
    return saved
  }

  async updateRentalPackages(
    id: string,
    dto: UpdateRentalPackagesDto,
    actorId: string,
    isStaff: boolean
  ): Promise<Apartment> {
    if (!ObjectId.isValid(id))
      throw new NotFoundException('APARTMENT_NOT_FOUND')
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!apartment) throw new NotFoundException('APARTMENT_NOT_FOUND')
    if (!isStaff && apartment.landlordId !== actorId) {
      throw new ForbiddenException('APARTMENT_PACKAGE_ACCESS_DENIED')
    }
    if ((apartment.pricingRevision ?? 0) !== dto.expectedRevision) {
      throw new ConflictException('APARTMENT_PACKAGE_REVISION_STALE')
    }

    const pricing = validateRentalPackages(
      toRentalPackageInputs(dto.rentalPackages)
    )
    const packages = await this.resolveExecutionPolicies(pricing.packages)
    apartment.pricingMode = pricing.pricingMode
    apartment.pricingRevision = (apartment.pricingRevision ?? 0) + 1
    apartment.rentalPackages = packages
    if (pricing.representativeMonthlyRent !== null) {
      recordPriceChange(apartment, pricing.representativeMonthlyRent)
    }
    if (!isStaff) {
      apartment.status = 'updating'
      apartment.isVerified = false
      apartment.approvedAt = null
      apartment.approvedBy = null
      apartment.submittedAt = new Date()
    }
    return this.saveAndNotify(apartment)
  }

  async updateMedia(
    id: string,
    dto: UpdateApartmentMediaDto
  ): Promise<Apartment> {
    if (
      dto.gallery === undefined &&
      dto.images360 === undefined &&
      dto.vrUrl === undefined
    ) {
      throw new BadRequestException(
        'Cần cung cấp danh sách ảnh thường, ảnh 360 độ hoặc liên kết VR Tour'
      )
    }

    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!apartment) {
      throw new NotFoundException(`Không tìm thấy căn hộ với ID: ${id}`)
    }

    if (dto.gallery !== undefined) apartment.gallery = dto.gallery
    if (dto.images360 !== undefined) apartment.images360 = dto.images360
    if (dto.vrUrl !== undefined) apartment.vrUrl = dto.vrUrl

    return this.saveAndNotify(apartment)
  }

  // ── Tạo bài đăng căn hộ mới ──
  async create(
    dto: CreateApartmentDto,
    landlordId: string
  ): Promise<Apartment> {
    this.logger.log(
      `Creating apartment: ${dto.title} by landlord: ${landlordId}`
    )

    const pricing = validateRentalPackages(
      toRentalPackageInputs(dto.rentalPackages)
    )
    const packages = await this.resolveExecutionPolicies(pricing.packages)

    // Auto find-or-create Project nếu có tên nhưng không có ID
    let resolvedProjectId = dto.projectId || null
    let resolvedProjectName = dto.projectName || ''
    if (!resolvedProjectId && resolvedProjectName) {
      const project = await this.projectsService.findOrCreate({
        name: resolvedProjectName,
        city: dto.city,
        district: dto.district ?? '',
        location: resolveLocation(dto),
      })
      resolvedProjectId = project._id.toString()
      resolvedProjectName = project.name
    }

    const apartment = this.apartmentRepository.create({
      title: dto.title,
      projectId: resolvedProjectId,
      projectName: resolvedProjectName,
      category: dto.category,
      description: dto.description ?? '',
      ownershipCertificate: dto.ownershipCertificate?.trim() || null,
      location: resolveLocation(dto),
      city: dto.city,
      district: dto.district ?? '',
      ward: dto.ward,
      street: dto.street,
      address: dto.address,
      priceMonthly: pricing.representativeMonthlyRent ?? dto.priceMonthly,
      priceHistory: [
        {
          price: pricing.representativeMonthlyRent ?? dto.priceMonthly,
          at: new Date(),
        },
      ],
      pricingMode: pricing.pricingMode,
      pricingRevision: pricing.pricingMode === 'packages' ? 1 : 0,
      rentalPackages: packages,
      area: dto.area,
      bedrooms: dto.bedrooms,
      bathrooms: dto.bathrooms,
      direction: dto.direction ?? '',
      balconyDirection: dto.balconyDirection ?? '',
      furniture: dto.furniture ?? '',
      moveInTime: dto.moveInTime ?? '',
      electricity: dto.electricity ?? '',
      water: dto.water ?? '',
      internet: dto.internet ?? '',
      gallery: dto.gallery || [],
      // Ảnh 360° / VR Tour do nhân viên chụp và gắn sau (PATCH :id/media).
      images360: [],
      vrUrl: '',
      amenities: dto.amenities || [],
      status: 'pending',
      isVerified: false,
      landlordId,
      submittedAt: new Date(),
    })

    const saved = await this.saveAndNotify(apartment)
    this.notifyStaffNewListing(saved).catch(err => {
      this.logger.error('Error notifying staff of new listing:', err)
    })
    return saved
  }

  // ── Phê duyệt bài đăng ──
  async approve(id: string, staffId: string): Promise<Apartment> {
    this.logger.log(`Approving apartment: ${id} by staff: ${staffId}`)
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!apartment) {
      throw new NotFoundException(`Không tìm thấy căn hộ với ID: ${id}`)
    }

    if (apartment.status !== 'pending') {
      throw new BadRequestException('Chỉ có thể duyệt bài đăng đang chờ duyệt')
    }

    if (apartment.pricingMode === 'packages') {
      validateRentalPackages(apartment.rentalPackages ?? [])
    }

    apartment.status = 'available'
    apartment.isVerified = true
    apartment.approvedAt = new Date()
    apartment.approvedBy = staffId
    apartment.expiresAt = new Date(Date.now() + LISTING_VALIDITY_DAYS * DAY_MS)
    apartment.rejectedReason = null

    const saved = await this.saveAndNotify(apartment)
    this.notificationsService
      .createNotification(
        saved.landlordId,
        'Tin đăng đã được duyệt',
        `Tin đăng "${saved.title}" của bạn đã được duyệt và đăng tải thành công.`,
        'listing-approved',
        { apartmentId: saved._id.toString() }
      )
      .catch(err =>
        this.logger.error(
          'Error sending landlord listing-approved notification:',
          err
        )
      )

    await this.publishSearchAlerts(saved, 'new_listing')

    return saved
  }

  // ── Từ chối bài đăng ──
  async reject(id: string, reason: string): Promise<Apartment> {
    this.logger.log(`Rejecting apartment: ${id} for reason: ${reason}`)
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!apartment) {
      throw new NotFoundException(`Không tìm thấy căn hộ với ID: ${id}`)
    }

    if (apartment.status !== 'pending') {
      throw new BadRequestException(
        'Chỉ có thể từ chối bài đăng đang chờ duyệt'
      )
    }

    apartment.status = 'rejected'
    apartment.isVerified = false
    apartment.rejectedReason = reason

    const saved = await this.saveAndNotify(apartment)
    this.notificationsService
      .createNotification(
        saved.landlordId,
        'Tin đăng bị từ chối duyệt',
        `Tin đăng "${saved.title}" của bạn đã bị từ chối. Lý do: ${reason}`,
        'listing-rejected',
        { apartmentId: saved._id.toString(), rejectedReason: reason }
      )
      .catch(err =>
        this.logger.error(
          'Error sending landlord listing-rejected notification:',
          err
        )
      )

    return saved
  }

  // ── Gửi lại bài đăng bị từ chối ──
  async resubmit(
    id: string,
    dto: CreateApartmentDto,
    landlordId: string
  ): Promise<Apartment> {
    this.logger.log(`Resubmitting apartment: ${id} by landlord: ${landlordId}`)
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!apartment) {
      throw new NotFoundException(`Không tìm thấy căn hộ với ID: ${id}`)
    }

    if (apartment.landlordId !== landlordId) {
      throw new ForbiddenException('Bạn không có quyền chỉnh sửa bài đăng này')
    }

    if (apartment.status !== 'rejected') {
      throw new BadRequestException('Chỉ có thể nộp lại bài đăng bị từ chối')
    }

    const pricing = validateRentalPackages(
      toRentalPackageInputs(dto.rentalPackages)
    )
    const packages = await this.resolveExecutionPolicies(pricing.packages)

    recordPriceChange(
      apartment,
      pricing.representativeMonthlyRent ?? dto.priceMonthly
    )
    // Cập nhật thông tin mới
    Object.assign(apartment, {
      title: dto.title,
      projectId: dto.projectId || null,
      projectName: dto.projectName || '',
      category: dto.category,
      description: dto.description ?? '',
      ownershipCertificate: dto.ownershipCertificate?.trim() || null,
      location: resolveLocation(dto),
      city: dto.city,
      district: dto.district ?? '',
      ward: dto.ward,
      street: dto.street,
      address: dto.address,
      priceMonthly: pricing.representativeMonthlyRent ?? dto.priceMonthly,
      pricingMode: pricing.pricingMode,
      pricingRevision: (apartment.pricingRevision ?? 0) + 1,
      rentalPackages: packages,
      area: dto.area,
      bedrooms: dto.bedrooms,
      bathrooms: dto.bathrooms,
      direction: dto.direction ?? '',
      balconyDirection: dto.balconyDirection ?? '',
      furniture: dto.furniture ?? '',
      moveInTime: dto.moveInTime ?? '',
      electricity: dto.electricity ?? '',
      water: dto.water ?? '',
      internet: dto.internet ?? '',
      gallery: dto.gallery || [],
      // images360/vrUrl giữ nguyên: chủ nhà không sửa, nhân viên đã gắn thì không được xoá.
      amenities: dto.amenities || [],
      status: 'pending',
      isVerified: false,
      submittedAt: new Date(),
      rejectedReason: null,
    })

    const saved = await this.saveAndNotify(apartment)
    this.notifyStaffNewListing(saved).catch(err => {
      this.logger.error('Error notifying staff of resubmitted listing:', err)
    })
    return saved
  }

  // ── Gia hạn bài đăng (30 ngày) ──
  async renew(id: string, userId: string, isStaff = false): Promise<Apartment> {
    this.logger.log(`Renewing apartment: ${id} by user: ${userId}`)
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!apartment) {
      throw new NotFoundException(`Không tìm thấy căn hộ với ID: ${id}`)
    }

    if (!isStaff && apartment.landlordId !== userId) {
      throw new ForbiddenException('Bạn không có quyền gia hạn bài đăng này')
    }

    if (apartment.status !== 'available' && apartment.status !== 'expired') {
      throw new BadRequestException(
        'Chỉ có thể gia hạn bài đăng đang hoạt động hoặc đã hết hạn'
      )
    }

    apartment.status = 'available'
    apartment.expiresAt = new Date(Date.now() + LISTING_VALIDITY_DAYS * DAY_MS)
    apartment.rejectedReason = null

    return this.saveAndNotify(apartment)
  }

  // ── Chỉnh sửa bài đăng (chỉ khi đang chờ duyệt hoặc bị từ chối) ──
  async update(
    id: string,
    dto: UpdateApartmentDto,
    userId: string,
    isStaff: boolean
  ): Promise<Apartment> {
    this.logger.log(`Updating apartment: ${id} by user: ${userId}`)
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!apartment) {
      throw new NotFoundException(`Không tìm thấy căn hộ với ID: ${id}`)
    }

    if (!isStaff && apartment.landlordId !== userId) {
      throw new ForbiddenException('Bạn không có quyền chỉnh sửa bài đăng này')
    }

    // Nhân viên sửa được mọi trạng thái và không kích hoạt duyệt lại; chủ nhà chỉ sửa khi chờ duyệt/bị từ chối.
    if (
      !isStaff &&
      apartment.status !== 'pending' &&
      apartment.status !== 'rejected'
    ) {
      throw new BadRequestException(
        'Chỉ có thể chỉnh sửa bài đăng đang chờ duyệt hoặc bị từ chối'
      )
    }

    const { rentalPackages, ...fields } = dto
    if (
      apartment.pricingMode === 'packages' &&
      fields.priceMonthly !== undefined &&
      rentalPackages === undefined
    ) {
      throw new BadRequestException(
        'Tin đăng tính giá theo gói: hãy chỉnh sửa rentalPackages thay vì priceMonthly'
      )
    }
    Object.assign(apartment, definedEntries(fields))
    // Đổi đường/phường/quận/thành phố mà không gửi location thì ghép lại để địa chỉ đầy đủ không bị cũ.
    const addressPartChanged = ADDRESS_PART_KEYS.some(
      key => fields[key] !== undefined
    )
    if (addressPartChanged && fields.location === undefined) {
      apartment.location = resolveLocation({ ...apartment, location: '' })
    }

    if (rentalPackages !== undefined) {
      const pricing = validateRentalPackages(
        toRentalPackageInputs(rentalPackages)
      )
      apartment.rentalPackages = await this.resolveExecutionPolicies(
        pricing.packages
      )
      apartment.pricingMode = pricing.pricingMode
      apartment.pricingRevision = (apartment.pricingRevision ?? 0) + 1
      recordPriceChange(
        apartment,
        pricing.representativeMonthlyRent ?? apartment.priceMonthly
      )
    }

    return this.saveAndNotify(apartment)
  }

  private async notifyStaffNewListing(apartment: Apartment): Promise<void> {
    const staffMembers = await this.userRepository.find({
      where: { role: 'staff' },
    })
    for (const staff of staffMembers) {
      await this.notificationsService.createNotification(
        staff._id.toString(),
        'Bài đăng mới chờ duyệt',
        `Tin đăng "${apartment.title}" đang chờ duyệt.`,
        'new-listing',
        { apartmentId: apartment._id.toString() }
      )
    }
  }

  private async resolveExecutionPolicies(
    packages: Apartment['rentalPackages']
  ): Promise<NonNullable<Apartment['rentalPackages']>> {
    const policyService = this.executionPoliciesService
    if (!packages || packages.length === 0 || !policyService) {
      return packages ?? []
    }
    const resolved = await Promise.all(
      packages.map(async packageItem => {
        const policySet = await policyService.validatePackagePolicies(
          packageItem.allowedExecutionPolicies,
          packageItem.defaultExecutionPolicy
        )
        return {
          ...packageItem,
          allowedExecutionPolicies: policySet.allowedExecutionPolicies,
          defaultExecutionPolicy: policySet.defaultExecutionPolicy,
        }
      })
    )
    return resolved
  }

  private async publishSearchAlerts(
    apartment: Apartment,
    triggerType: 'new_listing' | 'price_change' | 'status_change',
    details: { previousValue?: string; newValue?: string } = {}
  ): Promise<void> {
    try {
      await this.savedSearchesService.generateAlertsForApartment(
        apartment,
        triggerType,
        details
      )
    } catch (error: unknown) {
      this.logger.error(
        `Failed to generate saved-search alerts for apartment ${apartment._id.toString()}`,
        error instanceof Error ? error.stack : String(error)
      )
    }
  }
}
