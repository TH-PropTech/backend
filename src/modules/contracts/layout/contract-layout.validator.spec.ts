import {
  type ContractLayoutBlock,
  type ContractLayoutSupplementaryClause,
} from '../schemas/contract-layout-profile.schema'
import {
  assertProtectedLegalContentUnchanged,
  validateContractLayout,
} from './contract-layout.validator'

const blocks: ContractLayoutBlock[] = [
  { blockId: 'PARTIES', order: 1, title: 'Parties', visible: true },
  { blockId: 'PROPERTY', order: 2, title: 'Property', visible: true },
  {
    blockId: 'COMMERCIAL_TERMS',
    order: 3,
    title: 'Commercial terms',
    visible: true,
  },
  {
    blockId: 'LEGAL_ARTICLES',
    order: 4,
    title: 'Legal articles',
    visible: true,
  },
  { blockId: 'SIGNATURES', order: 5, title: 'Signatures', visible: true },
]

const clauses: ContractLayoutSupplementaryClause[] = []

describe('validateContractLayout', () => {
  it('accepts supported fields and enabled required blocks', () => {
    expect(validateContractLayout(blocks, clauses)).toBe(true)
  })

  it('rejects hiding a required block', () => {
    expect(() =>
      validateContractLayout(
        blocks.map(block =>
          block.blockId === 'SIGNATURES' ? { ...block, visible: false } : block
        ),
        clauses
      )
    ).toThrow('CONTRACT_LAYOUT_REQUIRED_BLOCK_HIDDEN')
  })

  it('rejects fields outside the privacy allowlist', () => {
    expect(() =>
      validateContractLayout(
        [
          ...blocks,
          {
            blockId: 'HEADER',
            order: 6,
            title: 'Header',
            visible: true,
            fields: [
              {
                fieldKey: 'PARTIES.tenantCccdFull',
                label: 'CCCD',
                visible: true,
              },
            ],
          } as unknown as ContractLayoutBlock,
        ],
        clauses
      )
    ).toThrow('CONTRACT_LAYOUT_FIELD_NOT_ALLOWED')
  })

  it('rejects script content in supplementary clauses', () => {
    expect(() =>
      validateContractLayout(blocks, [
        {
          id: 'extra-1',
          title: 'Extra',
          content: '<script>alert(1)</script>',
          enabled: true,
        },
      ])
    ).toThrow('CONTRACT_LAYOUT_SUPPLEMENTARY_CLAUSE_INVALID')
  })

  it('rejects replacement content for protected legal articles', () => {
    expect(() =>
      assertProtectedLegalContentUnchanged('Article 5 replacement')
    ).toThrow('CONTRACT_LAYOUT_PROTECTED_CONTENT')
  })
})
