import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { FindOptionsWhere, IsNull, Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Apartment } from './schemas/apartment.schema'
import { User } from '../users/schemas/user.schema'
import { ApartmentFilterDto } from './dto/apartment-filter.dto'
import {
  CreateApartmentDto,
  UpdateRentalPackagesDto,
} from './dto/create-apartment.dto'
import {
  validateRentalPackages,
  type RentalPackageInput,
} from './rental-package.util'
import { UpdateApartmentMediaDto } from './dto/update-apartment-media.dto'
import { NotificationsService } from '../notifications/notifications.service'
import { ProjectsService } from '../projects/projects.service'
import { BuildingsService } from '../buildings/buildings.service'
import { SavedSearchesService } from '../saved-searches/saved-searches.service'
import { RentalExecutionPoliciesService } from '../rental-flow-config/rental-execution-policies.service'

interface ApartmentMongoQuery {
  $or?: Array<Record<string, unknown>>
  city?: string | Record<string, unknown>
  district?: string | Record<string, unknown>
  ward?: string | Record<string, unknown>
  street?: string | Record<string, unknown>
  projectName?: string | Record<string, unknown>
  buildingId?: string
  category?: string
  priceMonthly?: { $gte?: number; $lte?: number }
  area?: { $gte?: number; $lte?: number }
  bedrooms?: number
  bathrooms?: number
  direction?: string
  balconyDirection?: string
  furniture?: string | Record<string, unknown>
  moveInTime?: string
  electricity?: string
  water?: string
  internet?: string
  isVerified?: boolean
  amenities?: { $all: string[] }
  [key: string]: unknown
}

type ApartmentWithLandlord = Apartment & { landlord?: User | null }

function toRentalPackageInputs(
  packages: CreateApartmentDto['rentalPackages']
): RentalPackageInput[] {
  if (!packages) return []

  return packages.map(packageItem => {
    const policy = packageItem.depositPolicy
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

    return {
      packageId: packageItem.packageId,
      version: packageItem.version,
      durationMonths: packageItem.durationMonths,
      monthlyRent: packageItem.monthlyRent,
      depositPolicy,
      status: packageItem.status ?? 'active',
      ...(packageItem.allowedExecutionPolicies
        ? { allowedExecutionPolicies: packageItem.allowedExecutionPolicies }
        : {}),
      ...(packageItem.defaultExecutionPolicy
        ? { defaultExecutionPolicy: packageItem.defaultExecutionPolicy }
        : {}),
    }
  })
}

function normalizeCity(city?: string): string {
  if (!city) return ''
  const norm = city.toLowerCase()
  if (
    norm.includes('hồ chí minh') ||
    norm.includes('tp.hcm') ||
    norm.includes('tphcm') ||
    norm.includes('hcm') ||
    norm.includes('sài gòn')
  ) {
    return 'hcm'
  }
  if (norm.includes('hà nội') || norm.includes('hn')) {
    return 'hn'
  }
  return norm
}

function buildVietnameseRegex(str: string): string {
  const search = str.toLowerCase()
  const map: Record<string, string> = {
    a: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    à: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    á: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    ả: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    ã: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    ạ: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    ă: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    ằ: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    ắ: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    ẳ: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    ẵ: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    ặ: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    â: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    ầ: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    ấ: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    ẩ: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    ẫ: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    ậ: '[aàáảãạăằắẳẵặâầấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    e: '[eèéẻẽẹêềếểễệEÈÉẺẼẸÊỀẾỂỄỆ]',
    è: '[eèéẻẽẹêềếểễệEÈÉẺẼẸÊỀẾỂỄỆ]',
    é: '[eèéẻẽẹêềếểễệEÈÉẺẼẸÊỀẾỂỄỆ]',
    ẻ: '[eèéẻẽẹêềếểễệEÈÉẺẼẸÊỀẾỂỄỆ]',
    ẽ: '[eèéẻẽẹêềếểễệEÈÉẺẼẸÊỀẾỂỄỆ]',
    ẹ: '[eèéẻẽẹêềếểễệEÈÉẺẼẸÊỀẾỂỄỆ]',
    ê: '[eèéẻẽẹêềếểễệEÈÉẺẼẸÊỀẾỂỄỆ]',
    ề: '[eèéẻẽẹêềếểễệEÈÉẺẼẸÊỀẾỂỄỆ]',
    ế: '[eèéẻẽẹêềếểễệEÈÉẺẼẸÊỀẾỂỄỆ]',
    ể: '[eèéẻẽẹêềếểễệEÈÉẺẼẸÊỀẾỂỄỆ]',
    ẽ: '[eèéẻẽẹêềếểễệEÈÉẺẼẸÊỀẾỂỄỆ]',
    ệ: '[eèéẻẽẹêềếểễệEÈÉẺẼẸÊỀẾỂỄỆ]',
    i: '[iìíỉĩịIÌÍỈĨỊ]',
    ì: '[iìíỉĩịIÌÍỈĨỊ]',
    í: '[iìíỉĩịIÌÍỈĨỊ]',
    ỉ: '[iìíỉĩịIÌÍỈĨỊ]',
    ĩ: '[iìíỉĩịIÌÍỈĨỊ]',
    ị: '[iìíỉĩịIÌÍỈĨỊ]',
    o: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ò: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ó: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ỏ: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    õ: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ọ: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ô: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ồ: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ố: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ổ: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ỗ: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ộ: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ơ: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ờ: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ớ: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ở: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ỡ: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    ợ: '[oòóỏõọôồốổỗộơờớởỡợOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ]',
    u: '[uùúủũụưừứửữựUÙÚỦŨỤƯỪỨỬỮỰ]',
    ù: '[uùúủũụưừứửữựUÙÚỦŨỤƯỪỨỬỮỰ]',
    ú: '[uùúủũụưừứửữựUÙÚỦŨỤƯỪỨỬỮỰ]',
    ủ: '[uùúủũụưừứửữựUÙÚỦŨỤƯỪỨỬỮỰ]',
    ũ: '[uùúủũụưừứửữựUÙÚỦŨỤƯỪỨỬỮỰ]',
    ụ: '[uùúủũụưừứửữựUÙÚỦŨỤƯỪỨỬỮỰ]',
    ư: '[uùúủũụưừứửữựUÙÚỦŨỤƯỪỨỬỮỰ]',
    ừ: '[uùúủũụưừứửữựUÙÚỦŨỤƯỪỨỬỮỰ]',
    ứ: '[uùúủũụưừứửữựUÙÚỦŨỤƯỪỨỬỮỰ]',
    ử: '[uùúủũụưừứửữựUÙÚỦŨỤƯỪỨỬỮỰ]',
    ữ: '[uùúủũụưừứửữựUÙÚỦŨỤƯỪỨỬỮỰ]',
    ự: '[uùúủũụưừứửữựUÙÚỦŨỤƯỪỨỬỮỰ]',
    y: '[yỳýỷỹỵYỲÝỶỸỴ]',
    ỳ: '[yỳýỷỹỵYỲÝỶỸỴ]',
    ý: '[yỳýỷỹỵYỲÝỶỸỴ]',
    ỷ: '[yỳýỷỹỵYỲÝỶỸỴ]',
    ỹ: '[yỳýỷỹỵYỲÝỶỸỴ]',
    ỵ: '[yỳýỷỹỵYỲÝỶỸỴ]',
    d: '[dđDĐ]',
    đ: '[dđDĐ]',
  }
  return search
    .split('')
    .map(char => map[char] || char)
    .join('')
}

@Injectable()
// TODO: Migrate to @nestjs/schedule @Cron('0 * * * *') when @nestjs/schedule is installed
export class ApartmentsService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ApartmentsService.name)
  private expirationInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    @InjectRepository(Apartment)
    private readonly apartmentRepository: Repository<Apartment>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly projectsService: ProjectsService,
    private readonly buildingsService: BuildingsService,
    private readonly savedSearchesService: SavedSearchesService,
    @Optional()
    private readonly executionPoliciesService?: RentalExecutionPoliciesService
  ) {}

  onApplicationBootstrap(): void {
    this.logger.log(
      'ApartmentsService initialized. Checking listing expirations...'
    )
    this.checkExpiration().catch(err => {
      this.logger.error('Error checking listing expirations on startup:', err)
    })

    // Run expiration check every hour
    this.expirationInterval = setInterval(
      () => {
        this.checkExpiration().catch(err => {
          this.logger.error(
            'Error checking listing expirations in interval:',
            err
          )
        })
      },
      60 * 60 * 1000
    )
  }

  onModuleDestroy(): void {
    if (this.expirationInterval) {
      clearInterval(this.expirationInterval)
      this.expirationInterval = null
      this.logger.log('Cleared expiration check interval.')
    }
  }

  async checkExpiration(): Promise<void> {
    const now = new Date()
    const expiredApartments = await this.apartmentRepository.find({
      where: {
        status: 'available',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        expiresAt: { $lte: now } as any,
      },
    })

    if (expiredApartments.length > 0) {
      this.logger.log(
        `Checking expiration: Found ${expiredApartments.length} expired apartments. Expiring them...`
      )
      for (const apt of expiredApartments) {
        apt.status = 'expired'
        await this.apartmentRepository.save(apt)
      }
    }
  }

  // ── Lấy toàn bộ danh sách căn hộ kèm bộ lọc ──
  async findAll(
    filters?: ApartmentFilterDto
  ): Promise<ApartmentWithLandlord[]> {
    this.logger.log(
      `Fetching apartments with filters: ${JSON.stringify(filters)}`
    )
    const query: ApartmentMongoQuery = {}

    if (filters) {
      const {
        search,
        city,
        district,
        ward,
        street,
        projectName,
        category,
        minPrice,
        maxPrice,
        minArea,
        maxArea,
        bedrooms,
        bathrooms,
        direction,
        balconyDirection,
        furniture,
        moveInTime,
        electricity,
        water,
        internet,
        isVerified,
        hasMedia,
        buildingId,
        amenities,
      } = filters

      // 1. Từ khóa tìm kiếm (Accent insensitive regex)
      if (search && search.trim() !== '') {
        const regexVal = { $regex: buildVietnameseRegex(search), $options: 'i' }
        query.$or = [
          { title: regexVal },
          { description: regexVal },
          { location: regexVal },
        ]
      }

      // 2. Thành phố (Chuẩn hóa TP.HCM và Hà Nội)
      if (city && city.trim() !== '') {
        const cityNorm = normalizeCity(city)
        if (cityNorm === 'hcm') {
          query.city = { $regex: 'Hồ Chí Minh|TP.HCM|HCM', $options: 'i' }
        } else if (cityNorm === 'hn') {
          query.city = { $regex: 'Hà Nội|HN', $options: 'i' }
        } else {
          query.city = { $regex: city, $options: 'i' }
        }
      }

      // 3. Quận, Phường, Đường phố, Dự án, Tòa nhà
      if (district && district.trim() !== '') {
        query.district = { $regex: district, $options: 'i' }
      }
      if (ward && ward.trim() !== '') {
        query.ward = { $regex: ward, $options: 'i' }
      }
      if (street && street.trim() !== '') {
        query.street = { $regex: street, $options: 'i' }
      }
      if (projectName && projectName.trim() !== '') {
        query.projectName = { $regex: projectName, $options: 'i' }
      }
      if (buildingId && buildingId.trim() !== '') {
        query.buildingId = buildingId
      }

      // 4. Phân loại căn hộ
      if (category && category !== 'Tất cả') {
        query.category = category
      }

      // 5. Khoảng giá (Triệu VNĐ -> VNĐ)
      if (minPrice !== undefined || maxPrice !== undefined) {
        query.priceMonthly = {}
        if (minPrice !== undefined) {
          query.priceMonthly.$gte = minPrice * 1000000
        }
        if (maxPrice !== undefined) {
          query.priceMonthly.$lte = maxPrice * 1000000
        }
      }

      // 6. Diện tích (m²)
      if (minArea !== undefined || maxArea !== undefined) {
        query.area = {}
        if (minArea !== undefined) {
          query.area.$gte = minArea
        }
        if (maxArea !== undefined) {
          query.area.$lte = maxArea
        }
      }

      // 7. Phòng ngủ / Phòng tắm
      if (bedrooms !== undefined) {
        query.bedrooms = bedrooms
      }
      if (bathrooms !== undefined) {
        query.bathrooms = bathrooms
      }

      // 8. Hướng nhà, Hướng ban công
      if (direction && direction !== 'all') {
        query.direction = direction
      }
      if (balconyDirection && balconyDirection !== 'all') {
        query.balconyDirection = balconyDirection
      }

      // 9. Nội thất (So khớp fuzzy chứa)
      if (furniture && furniture !== 'all') {
        query.furniture = { $regex: furniture, $options: 'i' }
      }

      // 10. Thời gian dọn vào
      if (moveInTime && moveInTime !== 'all') {
        query.moveInTime = moveInTime
      }

      // 11. Các loại chi phí
      if (electricity && electricity !== 'all') {
        query.electricity = electricity
      }
      if (water && water !== 'all') {
        query.water = water
      }
      if (internet && internet !== 'all') {
        query.internet = internet
      }

      // 12. Trạng thái kiểm duyệt
      if (isVerified === true) {
        query.isVerified = true
      }

      // 13. Có Media (gallery hoặc images360 hoặc vrUrl)
      if (hasMedia === true) {
        query.$or = [
          ...(query.$or || []),
          { 'gallery.0': { $exists: true } },
          { 'images360.0': { $exists: true } },
          { vrUrl: { $ne: '' } },
        ]
      }

      // 14. Tiện ích (Phải chứa tất cả các tiện ích được chọn)
      if (amenities && amenities.trim() !== '') {
        const amenitiesList = amenities
          .split(',')
          .map(a => a.trim())
          .filter(Boolean)
        if (amenitiesList.length > 0) {
          query.amenities = { $all: amenitiesList }
        }
      }
    }

    // Mặc định chỉ hiển thị bài đăng đã duyệt cho public
    if (!query.status && !query.landlordId) {
      query.status = 'available'
    }

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

    const result = await this.apartmentRepository.update(
      {
        _id: new ObjectId(apartmentId),
        status: 'available',
        rentalReservation: IsNull(),
      },
      {
        rentalReservation: {
          applicationId,
          reservedAt: new Date(),
          mode: 'application-accepted',
        },
      }
    )
    return result.affected === 1
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
    reservation.mode = 'deposit-paid'
    reservation.depositAgreementId = depositAgreementId
    reservation.depositPaidAt = new Date()
    await this.apartmentRepository.save(apartment)
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
    if (reservation.contractId === contractId) return true
    reservation.contractId = contractId
    reservation.leaseActivatedAt = new Date()
    await this.apartmentRepository.save(apartment)
    return true
  }

  async releaseRentalReservation(
    apartmentId: string,
    applicationId: string
  ): Promise<boolean> {
    if (!ObjectId.isValid(apartmentId)) return false
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(apartmentId) },
    })
    if (apartment?.rentalReservation?.applicationId !== applicationId) {
      return false
    }
    apartment.rentalReservation = null
    await this.apartmentRepository.save(apartment)
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

  private async attachCurrentLandlords(
    apartments: readonly Apartment[]
  ): Promise<ApartmentWithLandlord[]> {
    const landlordIds = [
      ...new Set(
        apartments
          .map(apartment => apartment.landlordId)
          .filter(landlordId => ObjectId.isValid(landlordId))
      ),
    ]

    const landlords =
      landlordIds.length > 0
        ? await this.userRepository.find({
            where: {
              _id: {
                $in: landlordIds.map(landlordId => new ObjectId(landlordId)),
              },
            } as unknown as FindOptionsWhere<User>,
          })
        : []
    const landlordMap = new Map(
      landlords.map(landlord => [landlord._id.toString(), landlord])
    )

    return apartments.map(apartment => ({
      ...apartment,
      landlord: landlordMap.get(apartment.landlordId) ?? null,
    }))
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
    const saved = await this.apartmentRepository.save(apartment)
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
    apartment.priceMonthly = priceMonthly
    const saved = await this.apartmentRepository.save(apartment)
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
      apartment.priceMonthly = pricing.representativeMonthlyRent
    }
    if (!isStaff) {
      apartment.status = 'updating'
      apartment.isVerified = false
      apartment.approvedAt = null
      apartment.approvedBy = null
      apartment.submittedAt = new Date()
    }
    return this.apartmentRepository.save(apartment)
  }

  async updateMedia(
    id: string,
    dto: UpdateApartmentMediaDto
  ): Promise<Apartment> {
    if (dto.gallery === undefined && dto.images360 === undefined) {
      throw new BadRequestException(
        'Cần cung cấp danh sách ảnh thường hoặc ảnh 360 độ'
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

    return this.apartmentRepository.save(apartment)
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
        district: dto.district,
        location: dto.location,
      })
      resolvedProjectId = project._id.toString()
      resolvedProjectName = project.name
    }

    // Auto find-or-create Building nếu có tên nhưng không có ID
    let resolvedBuildingId = dto.buildingId || null
    let resolvedBuildingName = dto.buildingName || ''
    if (!resolvedBuildingId && resolvedBuildingName) {
      const building = await this.buildingsService.findOrCreate({
        name: resolvedBuildingName,
        projectId: resolvedProjectId ?? null,
        projectName: resolvedProjectName || null,
        city: dto.city,
        district: dto.district,
        location: dto.location,
      })
      resolvedBuildingId = building._id.toString()
      resolvedBuildingName = building.name
    }

    const apartment = this.apartmentRepository.create({
      title: dto.title,
      buildingId: resolvedBuildingId,
      buildingName: resolvedBuildingName,
      projectId: resolvedProjectId,
      projectName: resolvedProjectName,
      category: dto.category,
      description: dto.description,
      location: dto.location,
      city: dto.city,
      district: dto.district,
      ward: dto.ward,
      street: dto.street,
      address: dto.address,
      priceMonthly: pricing.representativeMonthlyRent ?? dto.priceMonthly,
      pricingMode: pricing.pricingMode,
      pricingRevision: pricing.pricingMode === 'packages' ? 1 : 0,
      rentalPackages: packages,
      area: dto.area,
      bedrooms: dto.bedrooms,
      bathrooms: dto.bathrooms,
      direction: dto.direction,
      balconyDirection: dto.balconyDirection,
      furniture: dto.furniture,
      moveInTime: dto.moveInTime,
      electricity: dto.electricity,
      water: dto.water,
      internet: dto.internet,
      gallery: dto.gallery || [],
      images360: dto.images360 || [],
      vrUrl: dto.vrUrl || '',
      amenities: dto.amenities || [],
      status: 'pending',
      isVerified: false,
      landlordId,
      submittedAt: new Date(),
    })

    const saved = await this.apartmentRepository.save(apartment)
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

    if (apartment.pricingMode === 'packages') {
      validateRentalPackages(apartment.rentalPackages ?? [])
    }

    apartment.status = 'available'
    apartment.isVerified = true
    apartment.approvedAt = new Date()
    apartment.approvedBy = staffId
    apartment.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 ngày
    apartment.rejectedReason = null

    const saved = await this.apartmentRepository.save(apartment)
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

    apartment.status = 'rejected'
    apartment.isVerified = false
    apartment.rejectedReason = reason

    const saved = await this.apartmentRepository.save(apartment)
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

    // Cập nhật thông tin mới
    Object.assign(apartment, {
      title: dto.title,
      buildingId: dto.buildingId || null,
      buildingName: dto.buildingName || '',
      projectId: dto.projectId || null,
      projectName: dto.projectName || '',
      category: dto.category,
      description: dto.description,
      location: dto.location,
      city: dto.city,
      district: dto.district,
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
      direction: dto.direction,
      balconyDirection: dto.balconyDirection,
      furniture: dto.furniture,
      moveInTime: dto.moveInTime,
      electricity: dto.electricity,
      water: dto.water,
      internet: dto.internet,
      gallery: dto.gallery || [],
      images360: dto.images360 || [],
      vrUrl: dto.vrUrl || '',
      amenities: dto.amenities || [],
      status: 'pending',
      isVerified: false,
      submittedAt: new Date(),
      rejectedReason: null,
    })

    const saved = await this.apartmentRepository.save(apartment)
    this.notifyStaffNewListing(saved).catch(err => {
      this.logger.error('Error notifying staff of resubmitted listing:', err)
    })
    return saved
  }

  // ── Gia hạn bài đăng (30 ngày) ──
  async renew(id: string, landlordId: string): Promise<Apartment> {
    this.logger.log(`Renewing apartment: ${id} by landlord: ${landlordId}`)
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!apartment) {
      throw new NotFoundException(`Không tìm thấy căn hộ với ID: ${id}`)
    }

    if (apartment.landlordId !== landlordId) {
      throw new ForbiddenException('Bạn không có quyền gia hạn bài đăng này')
    }

    if (apartment.status !== 'available' && apartment.status !== 'expired') {
      throw new BadRequestException(
        'Chỉ có thể gia hạn bài đăng đang hoạt động hoặc đã hết hạn'
      )
    }

    apartment.status = 'available'
    apartment.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // Gia hạn thêm 30 ngày
    apartment.rejectedReason = null

    return this.apartmentRepository.save(apartment)
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
