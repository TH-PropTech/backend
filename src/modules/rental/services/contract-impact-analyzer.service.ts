import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Contract } from '../../contracts/schemas/contract.schema'

export interface ContractImpactReport {
  eligibleUnsignedDrafts: number
  partiallySigned: number
  immutableSigned: number
  totalContractsEvaluated: number
}

@Injectable()
export class ContractImpactAnalyzer {
  constructor(
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>
  ) {}

  async analyzeImpact(): Promise<ContractImpactReport> {
    const allContracts = await this.contractRepo.find()

    let eligibleUnsignedDrafts = 0
    let partiallySigned = 0
    let immutableSigned = 0

    for (const contract of allContracts) {
      const isTenantSigned = Boolean(contract.signedByTenant)
      const isLandlordSigned = Boolean(contract.signedByLandlord)
      const isDraftStatus = contract.status === 'draft'

      if (isDraftStatus && !isTenantSigned && !isLandlordSigned) {
        eligibleUnsignedDrafts++
      } else if (isTenantSigned !== isLandlordSigned) {
        partiallySigned++
      } else if (
        (isTenantSigned && isLandlordSigned) ||
        contract.status === 'active' ||
        contract.status === 'completed'
      ) {
        immutableSigned++
      }
    }

    return {
      eligibleUnsignedDrafts,
      partiallySigned,
      immutableSigned,
      totalContractsEvaluated: allContracts.length,
    }
  }
}
