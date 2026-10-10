import { Bm25Index, type Bm25Doc } from './legal-bm25'

interface Meta {
  title: string
}

const LEASE_DOC: Bm25Doc<Meta> = {
  id: 'lease',
  text: 'Điều 472. Hợp đồng thuê tài sản. Bên thuê phải đặt cọc trước khi nhận nhà. Tiền đặt cọc được hoàn trả khi kết thúc hợp đồng thuê nhà.',
  keywords: ['thuê nhà', 'đặt cọc'],
  meta: { title: 'Bộ luật Dân sự' },
}

const UNRELATED_DOC: Bm25Doc<Meta> = {
  id: 'tax',
  text: 'Thuế thu nhập cá nhân được tính theo biểu lũy tiến từng phần. Doanh nghiệp kê khai thuế hằng quý.',
  meta: { title: 'Luật Thuế' },
}

const PROCEDURE_DOC: Bm25Doc<Meta> = {
  id: 'registration',
  text: 'Thủ tục đăng ký tạm trú gồm căn cước công dân và giấy tờ nhà ở.',
  meta: { title: 'Thông tư tạm trú' },
}

describe('Bm25Index', () => {
  it('ranks the relevant legal article above an unrelated document', () => {
    const index = new Bm25Index<Meta>()
    index.build([UNRELATED_DOC, LEASE_DOC, PROCEDURE_DOC])

    // "thuế" (tax) folds to the same token as "thuê", so the tax document may
    // match weakly, but the lease article must rank first.
    const hits = index.search('thuê nhà đặt cọc có được hoàn lại không')
    expect(hits[0]?.id).toBe('lease')
    expect(hits[0]?.meta.title).toBe('Bộ luật Dân sự')
  })

  it('returns no hits for a query with no shared terms', () => {
    const index = new Bm25Index<Meta>()
    index.build([LEASE_DOC, UNRELATED_DOC])
    expect(index.search('lập trình hướng đối tượng javascript')).toEqual([])
  })

  it('applies a keyword boost when a document keyword appears in the query', () => {
    const plain: Bm25Doc<Meta> = {
      id: 'plain',
      text: 'Quy định chung về giao dịch dân sự và nghĩa vụ các bên.',
      meta: { title: 'plain' },
    }
    const tagged: Bm25Doc<Meta> = {
      ...plain,
      id: 'tagged',
      keywords: ['nghĩa vụ'],
      meta: { title: 'tagged' },
    }

    const index = new Bm25Index<Meta>()
    index.build([plain, tagged])
    const hits = index.search('nghia vu')
    const taggedHit = hits.find(h => h.id === 'tagged')
    const plainHit = hits.find(h => h.id === 'plain')
    expect(taggedHit).toBeDefined()
    expect(taggedHit?.score ?? 0).toBeGreaterThanOrEqual(2)
    expect(
      (taggedHit?.score ?? 0) - (plainHit?.score ?? 0)
    ).toBeGreaterThanOrEqual(1.9)
  })

  it('matches a keyword when all of its tokens are in the query (any order)', () => {
    const doc: Bm25Doc<Meta> = {
      id: 'k',
      text: 'Nội dung không liên quan đến từ khóa.',
      keywords: ['đặt cọc nhà'],
      meta: { title: 'k' },
    }
    const index = new Bm25Index<Meta>()
    index.build([doc])
    const hits = index.search('nhà cần đặt cọc bao nhiêu')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.score).toBeGreaterThanOrEqual(2)
  })

  it('respects limit and minScore', () => {
    const index = new Bm25Index<Meta>()
    index.build([LEASE_DOC, PROCEDURE_DOC, UNRELATED_DOC])

    expect(index.search('thuê nhà đặt cọc', 1)).toHaveLength(1)
    expect(index.search('thuê nhà đặt cọc', 10, 1000)).toEqual([])
  })

  it('returns [] for an empty query, an empty index or a non-positive limit', () => {
    const index = new Bm25Index<Meta>()
    expect(index.search('thuê nhà')).toEqual([])
    index.build([LEASE_DOC])
    expect(index.search('')).toEqual([])
    expect(index.search('   ')).toEqual([])
    expect(index.search('thuê nhà', 0)).toEqual([])
  })

  it('build replaces the previous index', () => {
    const index = new Bm25Index<Meta>()
    index.build([LEASE_DOC, PROCEDURE_DOC])
    expect(index.size()).toBe(2)

    index.build([UNRELATED_DOC])
    expect(index.size()).toBe(1)
    expect(index.search('đặt cọc nhà')).toEqual([])
  })

  it('reports size 0 for a new index', () => {
    expect(new Bm25Index<Meta>().size()).toBe(0)
  })
})
