import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Apartment } from './schemas/apartment.schema'
import { User } from '../users/schemas/user.schema'
import { ApartmentFilterDto } from './dto/apartment-filter.dto'

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
export class ApartmentsService {
  private readonly logger = new Logger(ApartmentsService.name)

  constructor(
    @InjectRepository(Apartment)
    private readonly apartmentRepository: Repository<Apartment>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>
  ) {}

  // ── Lấy toàn bộ danh sách căn hộ kèm bộ lọc ──
  async findAll(filters?: ApartmentFilterDto): Promise<Apartment[]> {
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

    return this.apartmentRepository.find({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      where: query as any,
      order: { createdAt: 'DESC' },
    })
  }

  // ── Lấy chi tiết căn hộ theo ID ──
  async findOne(id: string): Promise<Apartment & { landlord?: User | null }> {
    this.logger.log(`Fetching apartment details for ID: ${id}`)
    try {
      const apartment = await this.apartmentRepository.findOne({
        where: { _id: new ObjectId(id) },
      })
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

  // ── Lấy danh sách căn hộ của một chủ nhà ──
  async findByLandlord(landlordId: string): Promise<Apartment[]> {
    this.logger.log(`Fetching apartments for landlord: ${landlordId}`)
    return this.apartmentRepository.find({
      where: { landlordId },
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
    apartment.status = status
    if (isVerified !== undefined) {
      apartment.isVerified = isVerified
    } else if (status === 'available') {
      apartment.isVerified = true
    } else {
      apartment.isVerified = false
    }
    return this.apartmentRepository.save(apartment)
  }
}
