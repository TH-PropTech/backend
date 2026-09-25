import {
  hashCanonicalTemplateBody,
  hashText,
  normalizeTemplateClauses,
} from './contract-template.canonical'

describe('contract template canonicalization', () => {
  it('normalizes article order and produces deterministic semantic hashes', () => {
    const clauses = [
      {
        number: 2,
        heading: '  Payment  ',
        content: '  Pay on time  ',
        contentHash: '',
        citationIds: ['B', 'A'],
        variableRefs: ['z', 'a'],
        protected: false,
      },
      {
        number: 1,
        heading: 'Term',
        content: 'One year',
        contentHash: '',
        citationIds: ['A'],
        protected: true,
      },
    ]
    const normalized = normalizeTemplateClauses(clauses)

    expect(normalized.map(clause => clause.number)).toEqual([1, 2])
    expect(normalized[1]).toEqual(
      expect.objectContaining({
        heading: 'Payment',
        content: 'Pay on time',
        citationIds: ['A', 'B'],
        variableRefs: ['a', 'z'],
        protected: true,
      })
    )
    expect(
      hashCanonicalTemplateBody({
        legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
        schemaVersion: 2,
        clauses: normalized,
        annexDefinitions: [],
        citationIds: ['B', 'A'],
      })
    ).toBe(
      hashCanonicalTemplateBody({
        legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
        schemaVersion: 2,
        clauses: normalized,
        annexDefinitions: [],
        citationIds: ['B', 'A'],
      })
    )
    expect(hashText('same')).toBe(hashText('same'))
  })
})
