import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { Contract } from './schemas/contract.schema'

export type ContractArtifactFormat = 'pdf' | 'docx'

export interface ContractArtifactRenderer {
  render(contract: Contract, format: ContractArtifactFormat): Promise<Buffer>
}

@Injectable()
export class ContractArtifactService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>
  ) {}

  async generateDocument(
    contractId: string,
    actorId: string,
    isStaff: boolean,
    format: string
  ): Promise<Buffer> {
    if (format !== 'pdf' && format !== 'docx') {
      throw new BadRequestException('CONTRACT_ARTIFACT_FORMAT_INVALID')
    }
    if (!ObjectId.isValid(contractId)) {
      throw new NotFoundException('CONTRACT_NOT_FOUND')
    }
    const contract = await this.contractRepository.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    if (!contract) throw new NotFoundException('CONTRACT_NOT_FOUND')
    if (
      !isStaff &&
      contract.tenantId !== actorId &&
      contract.landlordId !== actorId
    ) {
      throw new ForbiddenException('CONTRACT_ARTIFACT_ACCESS_DENIED')
    }
    if (!contract.contentLockedHash || !contract.contentLockedAt) {
      throw new ConflictException('CONTRACT_CONTENT_NOT_LOCKED')
    }
    throw new ServiceUnavailableException('ARTIFACT_RENDERER_NOT_CONFIGURED')
  }
}
