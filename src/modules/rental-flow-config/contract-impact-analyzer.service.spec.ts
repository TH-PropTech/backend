import type { Repository } from 'typeorm'
import { ContractImpactAnalyzer } from './contract-impact-analyzer.service'
import type { Contract } from '../contracts/schemas/contract.schema'

interface MockRepository {
  find: jest.Mock
}

describe('ContractImpactAnalyzer', () => {
  let analyzer: ContractImpactAnalyzer
  let mockContractRepo: MockRepository

  beforeEach(() => {
    mockContractRepo = {
      find: jest.fn(),
    }
    analyzer = new ContractImpactAnalyzer(
      mockContractRepo as unknown as Repository<Contract>
    )
  })

  it('correctly categorizes contracts across draft, partial, and immutable statuses', async () => {
    const mockContracts: Partial<Contract>[] = [
      // 1. Unsigned draft -> eligible
      {
        status: 'draft',
        signedByTenant: false,
        signedByLandlord: false,
      },
      // 2. Another unsigned draft -> eligible
      {
        status: 'draft',
        signedByTenant: false,
        signedByLandlord: false,
      },
      // 3. Partially signed (tenant signed, landlord not yet)
      {
        status: 'draft',
        signedByTenant: true,
        signedByLandlord: false,
      },
      // 4. Partially signed (landlord signed, tenant not yet)
      {
        status: 'draft',
        signedByTenant: false,
        signedByLandlord: true,
      },
      // 5. Fully signed (both signed) -> immutable
      {
        status: 'active',
        signedByTenant: true,
        signedByLandlord: true,
      },
      // 6. Completed contract -> immutable
      {
        status: 'completed',
        signedByTenant: true,
        signedByLandlord: true,
      },
    ]

    mockContractRepo.find.mockResolvedValue(mockContracts)

    const report = await analyzer.analyzeImpact()

    expect(report.eligibleUnsignedDrafts).toBe(2)
    expect(report.partiallySigned).toBe(2)
    expect(report.immutableSigned).toBe(2)
    expect(report.totalContractsEvaluated).toBe(6)
  })

  it('handles empty contracts gracefully (boundary condition)', async () => {
    mockContractRepo.find.mockResolvedValue([])

    const report = await analyzer.analyzeImpact()

    expect(report.eligibleUnsignedDrafts).toBe(0)
    expect(report.partiallySigned).toBe(0)
    expect(report.immutableSigned).toBe(0)
    expect(report.totalContractsEvaluated).toBe(0)
  })
})
