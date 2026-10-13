import { computeCanonicalTermsHash } from './legal-terms.canonical'

describe('computeCanonicalTermsHash', () => {
  const baseInput = {
    key: 'rental-service-terms',
    version: 1,
    title: 'Điều khoản Dịch vụ Thuê Căn hộ',
    summary: 'Quy định các quyền và nghĩa vụ theo Luật Nhà ở 2023.',
    sections: [
      {
        id: 'sec-2',
        heading: 'Nghĩa vụ của người thuê',
        body: 'Thanh toán tiền thuê đúng hạn quy định.',
        order: 2,
      },
      {
        id: 'sec-1',
        heading: 'Quyền của người thuê',
        body: 'Nhận bàn giao nhà đúng thời hạn.',
        order: 1,
      },
    ],
  }

  it('generates a consistent 64-character hex hash', () => {
    const hash = computeCanonicalTermsHash(baseInput)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('produces the exact same hash regardless of the array order of sections', () => {
    const reversedSectionsInput = {
      ...baseInput,
      sections: [...baseInput.sections].reverse(),
    }

    const hash1 = computeCanonicalTermsHash(baseInput)
    const hash2 = computeCanonicalTermsHash(reversedSectionsInput)
    expect(hash1).toBe(hash2)
  })

  it('trims whitespace so trailing or leading spaces do not alter canonical hash', () => {
    const paddedInput = {
      ...baseInput,
      title: '  Điều khoản Dịch vụ Thuê Căn hộ  ',
      sections: [
        {
          id: 'sec-2',
          heading: ' Nghĩa vụ của người thuê ',
          body: 'Thanh toán tiền thuê đúng hạn quy định. ',
          order: 2,
        },
        {
          id: 'sec-1',
          heading: 'Quyền của người thuê',
          body: 'Nhận bàn giao nhà đúng thời hạn.',
          order: 1,
        },
      ],
    }

    const hash1 = computeCanonicalTermsHash(baseInput)
    const hash2 = computeCanonicalTermsHash(paddedInput)
    expect(hash1).toBe(hash2)
  })

  it('changes hash when any content is altered', () => {
    const modifiedInput = {
      ...baseInput,
      version: 2,
    }

    const hash1 = computeCanonicalTermsHash(baseInput)
    const hash2 = computeCanonicalTermsHash(modifiedInput)
    expect(hash1).not.toBe(hash2)
  })
})
