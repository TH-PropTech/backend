import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { RentalFlowProfile } from './schemas/rental-flow-profile.schema'
import { RentalFlowAssignment } from './schemas/rental-flow-assignment.schema'
import { RentalFlowAudit } from './schemas/rental-flow-audit.schema'
import { Contract } from '../contracts/schemas/contract.schema'
import { RentalFlowProfilesService } from './services/rental-flow-profiles.service'
import { RentalFlowAssignmentsService } from './services/rental-flow-assignments.service'
import { RentalFlowConfigResolver } from './services/rental-flow-config-resolver.service'
import { ContractImpactAnalyzer } from './services/contract-impact-analyzer.service'
import { RentalExecutionPolicy } from './schemas/rental-execution-policy.schema'
import { RentalExecutionPoliciesService } from './services/rental-execution-policies.service'
import { RentalExecutionPoliciesController } from './controllers/rental-execution-policies.controller'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RentalFlowProfile,
      RentalFlowAssignment,
      RentalFlowAudit,
      Contract,
      RentalExecutionPolicy,
    ]),
  ],
  controllers: [RentalExecutionPoliciesController],
  providers: [
    RentalFlowProfilesService,
    RentalFlowAssignmentsService,
    RentalFlowConfigResolver,
    ContractImpactAnalyzer,
    RentalExecutionPoliciesService,
  ],
  exports: [
    RentalFlowProfilesService,
    RentalFlowAssignmentsService,
    RentalFlowConfigResolver,
    ContractImpactAnalyzer,
    RentalExecutionPoliciesService,
  ],
})
export class RentalFlowConfigModule {}
