import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Contract } from './schemas/contract.schema'
import { SigningGrant } from './schemas/signing-grant.schema'
import { DepositAgreement } from './schemas/deposit-agreement.schema'
import { Apartment } from '../apartments/schemas/apartment.schema'
import { PoliciesModule } from '../policies/policies.module'
import { FabricModule } from '../fabric/fabric.module'
import { KycModule } from '../kyc/kyc.module'
import { ContractsService } from './contracts.service'
import { ContractsController } from './contracts.controller'
import { DepositAgreementsController } from './deposit-agreements.controller'
import { DepositAgreementsService } from './deposit-agreements.service'
import { PaymentsModule } from '../payments/payments.module'
import { ContractArtifactService } from './contract-artifact.service'
import { ContractDocumentProjector } from './legal/contract-document.projector'
import { ContractViewService } from './contract-view.service'
import { SmartOtpModule } from '../smart-otp/smart-otp.module'
import { SmartCaSigningSession } from './smartca/smartca-signing-session.schema'
import { SmartCaProvider } from './smartca/smartca.provider'
import { SmartCaSigningService } from './smartca/smartca-signing.service'
import { PropertyOwnershipTransferModule } from '../property-ownership-transfer/property-ownership-transfer.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contract,
      SigningGrant,
      DepositAgreement,
      Apartment,
      SmartCaSigningSession,
    ]),
    PoliciesModule,
    FabricModule,
    KycModule,
    PaymentsModule,
    SmartOtpModule,
    PropertyOwnershipTransferModule,
  ],
  controllers: [ContractsController, DepositAgreementsController],
  providers: [
    ContractsService,
    DepositAgreementsService,
    ContractArtifactService,
    ContractDocumentProjector,
    ContractViewService,
    SmartCaProvider,
    SmartCaSigningService,
  ],
  exports: [
    ContractsService,
    DepositAgreementsService,
    ContractArtifactService,
    ContractDocumentProjector,
    ContractViewService,
    SmartCaSigningService,
  ],
})
export class ContractsModule {}
