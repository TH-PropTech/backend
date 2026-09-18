import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { RentalFlowProfile } from './schemas/rental-flow-profile.schema'
import { RentalFlowAssignment } from './schemas/rental-flow-assignment.schema'
import { RentalFlowAudit } from './schemas/rental-flow-audit.schema'
import { Contract } from '../contracts/schemas/contract.schema'
import { RentalFlowProfilesService } from './rental-flow-profiles.service'
import { RentalFlowAssignmentsService } from './rental-flow-assignments.service'
import { RentalFlowConfigResolver } from './rental-flow-config-resolver.service'
import { ContractImpactAnalyzer } from './contract-impact-analyzer.service'
import { RentalFlowProfilesController } from './rental-flow-profiles.controller'
import { RentalFlowAssignmentsController } from './rental-flow-assignments.controller'
import { RentalExecutionPolicy } from './schemas/rental-execution-policy.schema'
import { RentalExecutionPoliciesService } from './rental-execution-policies.service'
import { RentalExecutionPoliciesController } from './rental-execution-policies.controller'

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
  controllers: [
    RentalFlowProfilesController,
    RentalFlowAssignmentsController,
    RentalExecutionPoliciesController,
  ],
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
