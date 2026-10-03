import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
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
import { MockSmartCaProvider } from './smartca/mock-smartca.provider'
import { SmartCaSigningService } from './smartca/smartca-signing.service'
import { SmartCaCallbackGuard } from './smartca/smartca-callback.guard'
import { ContractTemplate } from './legal/contract-template.schema'
import { ContractTemplateAudit } from './legal/contract-template-audit.schema'
import { ContractTemplateGovernanceService } from './legal/contract-template-governance.service'
import { ContractTemplatesController } from './legal/contract-templates.controller'
import { ContractArtifact } from './schemas/contract-artifact.schema'
import { ContractAmendment } from './schemas/contract-amendment.schema'
import { Payment } from '../payments/schemas/payment.schema'
import {
  CONTRACT_ARTIFACT_STORAGE,
  MongoGridFsArtifactStorage,
} from './contract-artifact.storage'
import { PropertyOwnershipTransferModule } from '../property-ownership-transfer/property-ownership-transfer.module'
import { ContractCommercialEditorService } from './contract-commercial-editor.service'
import { ContractCommercialEditorController } from './contract-commercial-editor.controller'
import { ContractAmendmentService } from './contract-amendment.service'
import { ContractAmendmentController } from './contract-amendment.controller'
import { DepositConfirmationResolver } from './deposit-confirmation.resolver'
import { FlowNotificationService } from './flow/flow-notification.service'
import { NotificationsModule } from '../notifications/notifications.module'
import { MoveInSettlementsModule } from '../move-in-settlements/move-in-settlements.module'
import { MoveInSettlement } from '../move-in-settlements/schemas/move-in-settlement.schema'
import { ContractLayoutProfile } from './layout/contract-layout-profile.schema'
import { ContractLayoutAudit } from './layout/contract-layout-audit.schema'
import { ContractLayoutService } from './layout/contract-layout.service'
import { ContractLayoutsController } from './layout/contract-layouts.controller'
import { ContractEvidencePackageService } from './contract-evidence-package.service'
import { ContractEvidencePackageExportService } from './contract-evidence-package.export.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contract,
      SigningGrant,
      DepositAgreement,
      Apartment,
      SmartCaSigningSession,
      ContractTemplate,
      ContractTemplateAudit,
      ContractArtifact,
      ContractAmendment,
      Payment,
      MoveInSettlement,
      ContractLayoutProfile,
      ContractLayoutAudit,
    ]),
    PoliciesModule,
    FabricModule,
    KycModule,
    PaymentsModule,
    SmartOtpModule,
    PropertyOwnershipTransferModule,
    NotificationsModule,
    MoveInSettlementsModule,
  ],
  controllers: [
    ContractsController,
    DepositAgreementsController,
    ContractTemplatesController,
    ContractCommercialEditorController,
    ContractAmendmentController,
    ContractLayoutsController,
  ],
  providers: [
    ContractsService,
    DepositAgreementsService,
    ContractArtifactService,
    ContractDocumentProjector,
    ContractViewService,
    MockSmartCaProvider,
    {
      provide: SmartCaProvider,
      inject: [ConfigService, MockSmartCaProvider],
      useFactory: (
        cfg: ConfigService,
        mock: MockSmartCaProvider
      ): SmartCaProvider | MockSmartCaProvider => {
        const isMock = cfg.get<{ isMock?: boolean }>('smartCA')?.isMock
        return isMock ? mock : new SmartCaProvider(cfg)
      },
    },
    SmartCaSigningService,
    SmartCaCallbackGuard,
    ContractTemplateGovernanceService,
    ContractCommercialEditorService,
    ContractAmendmentService,
    DepositConfirmationResolver,
    {
      provide: CONTRACT_ARTIFACT_STORAGE,
      useClass: MongoGridFsArtifactStorage,
    },
    FlowNotificationService,
    ContractLayoutService,
    ContractEvidencePackageService,
    ContractEvidencePackageExportService,
  ],
  exports: [
    ContractsService,
    DepositAgreementsService,
    ContractArtifactService,
    ContractDocumentProjector,
    ContractViewService,
    SmartCaSigningService,
    ContractTemplateGovernanceService,
    ContractCommercialEditorService,
    ContractAmendmentService,
    DepositConfirmationResolver,
    ContractEvidencePackageService,
  ],
})
export class ContractsModule {}
