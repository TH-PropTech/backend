import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateApartmentDto } from './create-apartment.dto'
import { RejectApartmentDto } from './reject-apartment.dto'
import { UpdateApartmentDto } from './update-apartment.dto'
import { UpdateApartmentMediaDto } from './update-apartment-media.dto'

const validPayload = {
  title: 'Căn hộ 2PN Vinhomes Grand Park',
  category: 'Căn hộ chung cư',
  description:
    'Căn hộ 2 phòng ngủ đầy đủ nội thất, gần trung tâm thương mại và trường học, an ninh 24/7.',
  location: 'Q9, TP.HCM',
  city: 'TP.HCM',
  district: 'Quận 9',
  ward: 'Long Thạnh Mỹ',
  street: 'Nguyễn Xiển',
  address: '12 Nguyễn Xiển',
  priceMonthly: 15_000_000,
  area: 65,
  bedrooms: 2,
  bathrooms: 2,
  direction: 'Đông',
  balconyDirection: 'Nam',
  furniture: 'Đầy đủ',
  moveInTime: 'Ngay',
  electricity: '3.500đ/kWh',
  water: '18.000đ/m3',
  internet: 'Miễn phí',
}

async function invalidFields(
  payload: Record<string, unknown>
): Promise<string[]> {
  const errors = await validate(plainToInstance(CreateApartmentDto, payload))
  return errors.map(error => error.property)
}

describe('CreateApartmentDto validation (design §8)', () => {
  it('accepts a complete valid payload', async () => {
    expect(await invalidFields(validPayload)).toEqual([])
  })

  it('accepts settlement policy nested in a rental package', async () => {
    expect(
      await invalidFields({
        ...validPayload,
        rentalPackages: [
          {
            packageId: 'pkg-12m',
            version: 1,
            durationMonths: 12,
            monthlyRent: 12_000_000,
            depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
            status: 'active',
            settlementPolicy: {
              holdingDeposit: { type: 'PERCENT_OF_SECURITY', percent: 25 },
              allowedPaymentCycles: [1, 3, 6],
              defaultPaymentCycle: 3,
              firstPaymentDueOffsetDays: 3,
            },
          },
        ],
      })
    ).toEqual([])
  })

  describe('prepaid rent in a rental package', () => {
    const withPrepaid = (prepaidRent: unknown): Record<string, unknown> => ({
      ...validPayload,
      rentalPackages: [
        {
          packageId: 'pkg-12m',
          version: 1,
          durationMonths: 12,
          monthlyRent: 12_000_000,
          depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
          status: 'active',
          prepaidRent,
        },
      ],
    })

    it.each([
      [{ type: 'NONE' }],
      [{ type: 'FULL' }],
      [{ type: 'MONTHS', months: 3 }],
    ])('accepts %j', async prepaidRent => {
      expect(await invalidFields(withPrepaid(prepaidRent))).toEqual([])
    })

    it.each([
      [{ type: 'WHENEVER' }],
      [{ type: 'MONTHS', months: 0 }],
      [{ type: 'MONTHS', months: 25 }],
      [{ type: 'MONTHS', months: 1.5 }],
    ])('rejects %j', async prepaidRent => {
      expect(await invalidFields(withPrepaid(prepaidRent))).toContain(
        'rentalPackages'
      )
    })
  })

  it('rejects invalid settlement policy fields in a rental package', async () => {
    expect(
      await invalidFields({
        ...validPayload,
        rentalPackages: [
          {
            packageId: 'pkg-12m',
            version: 1,
            durationMonths: 12,
            monthlyRent: 12_000_000,
            depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
            status: 'active',
            settlementPolicy: {
              allowedPaymentCycles: [2],
              defaultPaymentCycle: 2,
              firstPaymentDueOffsetDays: 16,
            },
          },
        ],
      })
    ).toContain('rentalPackages')
  })

  it.each([
    ['title shorter than 10', { title: 'ngắn' }, 'title'],
    ['title longer than 200', { title: 'a'.repeat(201) }, 'title'],
    ['description shorter than 10', { description: 'quá ngắn' }, 'description'],
    [
      'description longer than 5000',
      { description: 'a'.repeat(5001) },
      'description',
    ],
    ['priceMonthly of zero', { priceMonthly: 0 }, 'priceMonthly'],
    ['negative priceMonthly', { priceMonthly: -1 }, 'priceMonthly'],
    ['area of zero', { area: 0 }, 'area'],
    ['negative bedrooms', { bedrooms: -1 }, 'bedrooms'],
    ['fractional bedrooms', { bedrooms: 1.5 }, 'bedrooms'],
    ['negative bathrooms', { bathrooms: -1 }, 'bathrooms'],
    ['empty city', { city: '' }, 'city'],
    ['empty ward', { ward: '' }, 'ward'],
    ['empty street', { street: '' }, 'street'],
    [
      'more than 20 gallery images',
      { gallery: Array.from({ length: 21 }, (_, i) => `https://x/${i}.jpg`) },
      'gallery',
    ],
    [
      'more than 30 amenities',
      { amenities: Array.from({ length: 31 }, (_, i) => `tiện ích ${i}`) },
      'amenities',
    ],
  ])('rejects %s', async (_label, override, property) => {
    expect(await invalidFields({ ...validPayload, ...override })).toContain(
      property
    )
  })

  it('accepts a payload without a description (optional field)', async () => {
    const withoutDescription: Record<string, unknown> = { ...validPayload }
    delete withoutDescription['description']
    expect(
      await invalidFields(withoutDescription as typeof validPayload)
    ).toEqual([])
  })

  it('accepts a payload without district (administrative structure since 2025-07-01)', async () => {
    const withoutDistrict: Record<string, unknown> = { ...validPayload }
    delete withoutDistrict['district']
    expect(await invalidFields(withoutDistrict as typeof validPayload)).toEqual(
      []
    )
    expect(await invalidFields({ ...validPayload, district: '' })).toEqual([])
  })

  it.each([
    'location',
    'direction',
    'balconyDirection',
    'furniture',
    'moveInTime',
    'electricity',
    'water',
    'internet',
  ])('accepts a payload that omits the optional field %s', async field => {
    const { [field]: omitted, ...rest } = validPayload as Record<
      string,
      unknown
    >
    expect(omitted).toBeDefined()

    expect(await invalidFields(rest)).toEqual([])
  })

  it.each([['Căn hộ chung cư'], ['Chung cư mini, căn hộ dịch vụ']])(
    'accepts the allowed category "%s"',
    async category => {
      expect(await invalidFields({ ...validPayload, category })).toEqual([])
    }
  )

  it.each([
    ['Nhà riêng'],
    ['Nhà biệt thự, liền kề'],
    ['Nhà trọ, phòng trọ'],
    ['Shophouse, nhà phố thương mại'],
    ['Văn phòng'],
    ['Bất động sản khác'],
    [''],
  ])('rejects the category "%s": apartments only', async category => {
    expect(await invalidFields({ ...validPayload, category })).toContain(
      'category'
    )
  })

  it.each([
    ['title of exactly 10', { title: 'a'.repeat(10) }],
    ['title of exactly 200', { title: 'a'.repeat(200) }],
    ['description of exactly 10', { description: 'a'.repeat(10) }],
    ['an empty description', { description: '' }],
    ['zero bedrooms (studio)', { bedrooms: 0 }],
    [
      'exactly 20 gallery images',
      { gallery: Array.from({ length: 20 }, (_, i) => `https://x/${i}.jpg`) },
    ],
  ])('accepts boundary %s', async (_label, override) => {
    expect(await invalidFields({ ...validPayload, ...override })).toEqual([])
  })
})

describe('UpdateApartmentMediaDto vrUrl', () => {
  const check = async (vrUrl: unknown): Promise<string[]> =>
    (await validate(plainToInstance(UpdateApartmentMediaDto, { vrUrl }))).map(
      error => error.property
    )

  it.each([
    'https://my.matterport.com/show/?m=abc',
    'https://kuula.co/share/abc',
    '',
  ])('accepts %p (empty clears the link)', async vrUrl => {
    expect(await check(vrUrl)).toEqual([])
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://insecure.example.com/tour',
    'not a url',
    'ftp://example.com/tour',
  ])('rejects %p: only https links are allowed', async vrUrl => {
    expect(await check(vrUrl)).toContain('vrUrl')
  })

  it('rejects a link longer than 2048 characters', async () => {
    expect(await check(`https://example.com/${'a'.repeat(2050)}`)).toContain(
      'vrUrl'
    )
  })
})

describe('UpdateApartmentDto', () => {
  it('accepts an empty partial payload', async () => {
    const errors = await validate(plainToInstance(UpdateApartmentDto, {}))

    expect(errors).toEqual([])
  })

  it('still enforces the create rules on provided fields', async () => {
    const errors = await validate(
      plainToInstance(UpdateApartmentDto, { title: 'ngắn' })
    )

    expect(errors.map(error => error.property)).toEqual(['title'])
  })
})

describe('RejectApartmentDto', () => {
  const check = async (rejectedReason: unknown): Promise<number> =>
    (await validate(plainToInstance(RejectApartmentDto, { rejectedReason })))
      .length

  it('requires a reason of at least 10 characters', async () => {
    expect(await check('Ảnh không rõ ràng')).toBe(0)
    expect(await check('ngắn')).toBeGreaterThan(0)
    expect(await check('')).toBeGreaterThan(0)
    expect(await check(undefined)).toBeGreaterThan(0)
  })
})
