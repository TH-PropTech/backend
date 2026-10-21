import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Apartment } from '../../schemas/apartment.schema'
import { User } from '../../../users/schemas/user.schema'
import { Contract } from '../../../contracts/schemas/contract.schema'
import { priceAt, type PriceHistoryPoint } from '../../utils/price-history.util'
import type {
  ApartmentInsightsResponseDto,
  PriceTrendSeriesDto,
  TrustItemDto,
} from '../dto/apartment-insights-response.dto'

const TREND_MONTHS = 12
/** Trần số căn dùng tính trung bình dự án/quận để chặn truy vấn quá lớn. */
const PEER_LIMIT = 500
const LIVE_STATUSES: Apartment['status'][] = ['available', 'rented', 'updating']

@Injectable()
export class ApartmentInsightsService {
  constructor(
    @InjectRepository(Apartment)
    private readonly apartments: Repository<Apartment>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Contract)
    private readonly contracts: Repository<Contract>
  ) {}

  /** Biến động giá 12 tháng và điểm tin cậy tính từ dữ liệu thật. [uc_customer_apartment] */
  async getInsights(
    id: string,
    now: Date = new Date()
  ): Promise<ApartmentInsightsResponseDto> {
    if (!ObjectId.isValid(id)) {
      throw new NotFoundException(`Không tìm thấy căn hộ với ID: ${id}`)
    }
    const apartment = await this.apartments.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!apartment) {
      throw new NotFoundException(`Không tìm thấy căn hộ với ID: ${id}`)
    }
    const [priceTrend, trust] = await Promise.all([
      this.buildPriceTrend(apartment, now),
      this.buildTrust(apartment),
    ])
    return { priceTrend, trust }
  }

  private async buildPriceTrend(
    apartment: Apartment,
    now: Date
  ): Promise<PriceTrendSeriesDto> {
    const monthEnds = this.monthEnds(now)
    const projectPeers = apartment.projectId
      ? await this.findPeers({ projectId: apartment.projectId })
      : []
    const districtPeers = apartment.district
      ? await this.findPeers({
          district: apartment.district,
          city: apartment.city,
        })
      : []

    return {
      months: monthEnds.map(end => this.monthLabel(end)),
      apartment: this.series(this.historyOf(apartment), monthEnds),
      project: projectPeers.length
        ? this.average(projectPeers, monthEnds)
        : null,
      district: districtPeers.length
        ? this.average(districtPeers, monthEnds)
        : null,
      projectName: apartment.projectName || null,
      districtName: apartment.district || null,
      projectSampleCount: projectPeers.length,
      districtSampleCount: districtPeers.length,
    }
  }

  private async findPeers(
    where: Partial<Pick<Apartment, 'projectId' | 'district' | 'city'>>
  ): Promise<Apartment[]> {
    const records = await this.apartments.find({
      where: where as never,
      take: PEER_LIMIT,
    })
    return records.filter(record => LIVE_STATUSES.includes(record.status))
  }

  private series(
    history: readonly PriceHistoryPoint[],
    monthEnds: readonly Date[]
  ): Array<number | null> {
    return monthEnds.map(end => priceAt(history, end))
  }

  private average(
    apartments: readonly Apartment[],
    monthEnds: readonly Date[]
  ): Array<number | null> {
    const histories = apartments.map(record => this.historyOf(record))
    return monthEnds.map(end => {
      const prices = histories
        .map(history => priceAt(history, end))
        .filter((price): price is number => price !== null)
      if (!prices.length) return null
      return Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
    })
  }

  /** Căn chưa có lịch sử: coi giá hiện tại có hiệu lực từ ngày tạo tin. */
  private historyOf(apartment: Apartment): PriceHistoryPoint[] {
    if (apartment.priceHistory?.length) return apartment.priceHistory
    return [{ price: apartment.priceMonthly, at: apartment.createdAt }]
  }

  /** Mốc cuối mỗi tháng trong 12 tháng gần nhất; tháng hiện tại dùng đúng `now`. */
  private monthEnds(now: Date): Date[] {
    const ends: Date[] = []
    for (let offset = TREND_MONTHS - 1; offset >= 0; offset -= 1) {
      ends.push(
        offset === 0
          ? now
          : new Date(
              Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth() - offset + 1,
                0,
                23,
                59,
                59
              )
            )
      )
    }
    return ends
  }

  private monthLabel(date: Date): string {
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    return `${date.getUTCFullYear()}-${month}`
  }

  private async buildTrust(
    apartment: Apartment
  ): Promise<ApartmentInsightsResponseDto['trust']> {
    const landlord = ObjectId.isValid(apartment.landlordId)
      ? await this.users.findOne({
          where: { _id: new ObjectId(apartment.landlordId) },
        })
      : null
    const contracts = await this.contracts.find({
      where: { landlordId: apartment.landlordId },
    })

    const kept = contracts.filter(
      c => c.status === 'active' || c.status === 'completed'
    ).length
    const broken = contracts.filter(
      c => c.status === 'terminated' || c.status === 'cancelled'
    ).length
    const ledgerConfirmed = contracts.some(c => c.ledgerStatus === 'confirmed')
    const recordMax = 20
    const recordPoints =
      kept + broken === 0 ? 0 : Math.round((kept / (kept + broken)) * recordMax)

    const items: TrustItemDto[] = [
      {
        key: 'landlord-kyc',
        label: 'Chủ hộ đã xác minh định danh (KYC Landlord)',
        ok: landlord?.kycStatus === 'verified',
        points: landlord?.kycStatus === 'verified' ? 30 : 0,
        maxPoints: 30,
      },
      {
        key: 'ownership',
        label: 'Có số giấy chứng nhận quyền sở hữu (Sổ hồng)',
        ok: Boolean(apartment.ownershipCertificate),
        points: apartment.ownershipCertificate ? 20 : 0,
        maxPoints: 20,
      },
      {
        key: 'listing-verified',
        label: 'Tin đăng đã được nhân viên kiểm duyệt',
        ok: apartment.isVerified,
        points: apartment.isVerified ? 15 : 0,
        maxPoints: 15,
      },
      {
        key: 'ledger',
        label: 'Có hợp đồng đã ghi nhận trên Blockchain',
        ok: ledgerConfirmed,
        points: ledgerConfirmed ? 15 : 0,
        maxPoints: 15,
      },
      {
        key: 'record',
        label:
          kept + broken === 0
            ? 'Chưa có lịch sử hợp đồng của chủ hộ'
            : `Hợp đồng thực hiện đầy đủ: ${kept}/${kept + broken}`,
        ok: kept + broken > 0 && broken === 0,
        points: recordPoints,
        maxPoints: recordMax,
      },
    ]
    return {
      score: items.reduce((sum, item) => sum + item.points, 0),
      items,
    }
  }
}
