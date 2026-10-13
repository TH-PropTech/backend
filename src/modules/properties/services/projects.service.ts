import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Project } from '../schemas/project.schema'
import { Apartment } from '../schemas/apartment.schema'
import { ProjectFilterDto } from '../dto/project-filter.dto'
import { CreateProjectDto } from '../dto/create-project.dto'

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
    ã: '[aàáảãạăằắẳẵặâàấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
    ạ: '[aàáảãạăằắẳẵặâàấẩẫậAÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬ]',
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

interface ProjectMongoQuery {
  $or?: Array<Record<string, unknown>>
  city?: string | Record<string, unknown>
  district?: string | Record<string, unknown>
  name?: { $in: string[] }
  [key: string]: unknown
}

interface ProjectApartmentMongoQuery {
  priceMonthly?: { $gte?: number; $lte?: number }
  bedrooms?: number
  bathrooms?: number
  amenities?: { $all: string[] }
  [key: string]: unknown
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name)

  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(Apartment)
    private readonly apartmentRepository: Repository<Apartment>
  ) {}

  // ── Lấy toàn bộ danh sách dự án kèm bộ lọc ──
  async findAll(filters?: ProjectFilterDto): Promise<Project[]> {
    this.logger.log(
      `Fetching projects with filters: ${JSON.stringify(filters)}`
    )
    const query: ProjectMongoQuery = {}

    if (filters) {
      const {
        search,
        city,
        district,
        minPrice,
        maxPrice,
        bedrooms,
        bathrooms,
        amenities,
      } = filters

      // 1. Từ khóa tìm kiếm (Tên dự án, mô tả, chủ đầu tư, địa điểm)
      if (search && search.trim() !== '') {
        const regexVal = { $regex: buildVietnameseRegex(search), $options: 'i' }
        query.$or = [
          { name: regexVal },
          { description: regexVal },
          { investor: regexVal },
          { location: regexVal },
        ]
      }

      // 2. Thành phố (TP.HCM / Hà Nội)
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

      // 3. Quận/Huyện
      if (district && district.trim() !== '') {
        query.district = { $regex: district, $options: 'i' }
      }

      // 4. Lọc chéo sang căn hộ (Cross-querying: price range, bedrooms, bathrooms, amenities)
      const hasApartmentFilters =
        minPrice !== undefined ||
        maxPrice !== undefined ||
        bedrooms !== undefined ||
        bathrooms !== undefined ||
        (amenities && amenities.trim() !== '')

      if (hasApartmentFilters) {
        const aptQuery: ProjectApartmentMongoQuery = {}

        if (minPrice !== undefined || maxPrice !== undefined) {
          aptQuery.priceMonthly = {}
          if (minPrice !== undefined) {
            aptQuery.priceMonthly.$gte = minPrice * 1000000
          }
          if (maxPrice !== undefined) {
            aptQuery.priceMonthly.$lte = maxPrice * 1000000
          }
        }

        if (bedrooms !== undefined) {
          aptQuery.bedrooms = bedrooms
        }

        if (bathrooms !== undefined) {
          aptQuery.bathrooms = bathrooms
        }

        if (amenities && amenities.trim() !== '') {
          const amenitiesList = amenities
            .split(',')
            .map(a => a.trim())
            .filter(Boolean)
          if (amenitiesList.length > 0) {
            aptQuery.amenities = { $all: amenitiesList }
          }
        }

        // Fetch matched apartments to collect project names
        const matchedApartments = await this.apartmentRepository.find({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          where: aptQuery as any,
          select: ['projectName'],
        })

        const matchedProjectNames = matchedApartments
          .map((apt: Apartment) => apt.projectName)
          .filter(
            (name: string | null | undefined): name is string =>
              typeof name === 'string' && name.trim() !== ''
          )

        const uniqueProjectNames = Array.from(new Set(matchedProjectNames))

        if (uniqueProjectNames.length > 0) {
          query.name = { $in: uniqueProjectNames }
        } else {
          // Không có căn hộ nào thỏa mãn bộ lọc, trả về danh sách rỗng luôn
          return []
        }
      }
    }

    return this.projectRepository.find({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      where: query as any,
      order: { createdAt: 'DESC' },
    })
  }

  // ── Lấy chi tiết dự án theo ID ──
  async findOne(id: string): Promise<Project> {
    this.logger.log(`Fetching project details for ID: ${id}`)
    try {
      const project = await this.projectRepository.findOne({
        where: { _id: new ObjectId(id) },
      })
      if (!project) {
        throw new NotFoundException(`Không tìm thấy dự án với ID: ${id}`)
      }
      return project
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error
      }
      throw new NotFoundException(
        `ID dự án không hợp lệ hoặc không tìm thấy: ${id}`
      )
    }
  }

  // ── Tìm hoặc Tạo mới dự án ──
  async findOrCreate(dto: CreateProjectDto): Promise<Project> {
    this.logger.log(`Find or Create project: ${dto.name}`)
    const existing = await this.projectRepository.findOne({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      where: { name: { $regex: `^${dto.name}$`, $options: 'i' } } as any,
    })
    if (existing) {
      this.logger.log(
        `Found existing project: ${dto.name} with ID: ${existing._id.toString()}`
      )
      return existing
    }

    const project = this.projectRepository.create({
      name: dto.name,
      city: dto.city,
      district: dto.district,
      location: dto.location,
      description: dto.description || '',
      investor: dto.investor || '',
      amenities: dto.amenities || [],
      images: dto.images || [],
    })
    return this.projectRepository.save(project)
  }
}
