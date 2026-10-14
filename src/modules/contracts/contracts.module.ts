import { Module } from '@nestjs/common'
import { User } from '../users/schemas/user.schema'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Contract } from './schemas/contract.schema'
import { SigningGrant } from './schemas/signing-grant.schema'
import { DepositAgreement } from './schemas/deposit-agreement.schema'
import { Apartment } from '../properties/schemas/apartment.schema'
import { Booking } from '../bookings/schemas/booking.schema'
import { Dispute } from '../community/schemas/dispute.schema'
import { RentalApplication } from '../rental/schemas/rental-application.schema'
import { LegalModule } from '../legal/legal.module'
import { FabricModule } from '../fabric/fabric.module'
import { UsersModule } from '../users/users.module'
import { EkycModule } from '../ekyc/ekyc.module'
import { ContractsService } from './services/contracts.service'
import { ContractsController } from './controllers/contracts.controller'
import { DepositAgreementsController } from './controllers/deposit-agreements.controller'
import { DepositAgreementsService } from './services/deposit-agreements.service'
import { PaymentsModule } from '../payments/payments.module'
import { ContractArtifactService } from './services/contract-artifact.service'
import { ContractDocumentProjector } from './legal/contract-document.projector'
import { ContractViewService } from './services/contract-view.service'
import { AuthModule } from '../auth/auth.module'
import { SmartCaSigningService } from './services/smartca-signing.service'
import { DigitalSignatureModule } from '../digital-signature/digital-signature.module'
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
} from './services/contract-artifact.storage'
import { ContractCommercialEditorService } from './services/contract-commercial-editor.service'
import { ContractCommercialEditorController } from './controllers/contract-commercial-editor.controller'
import { ContractAmendmentService } from './services/contract-amendment.service'
import { ContractAmendmentController } from './controllers/contract-amendment.controller'
import { DepositConfirmationResolver } from './services/deposit-confirmation.resolver'
import { FlowNotificationService } from './flow/flow-notification.service'
import { NotificationsModule } from '../notifications/notifications.module'
import { MoveInSettlement } from '../rental/schemas/move-in-settlement.schema'
import { ContractLayoutProfile } from './layout/contract-layout-profile.schema'
import { ContractLayoutAudit } from './layout/contract-layout-audit.schema'
import { ContractLayoutService } from './layout/contract-layout.service'
import { ContractLayoutsController } from './layout/contract-layouts.controller'
import { ContractSignedArtifact } from './signed-artifact/contract-signed-artifact.schema'
import { SignedArtifactService } from './signed-artifact/signed-artifact.service'
import { ContractEvidencePackageService } from './services/contract-evidence-package.service'
import { ContractEvidencePackageExportService } from './services/contract-evidence-package.export.service'
import { OwnershipTransferController } from './controllers/ownership-transfer.controller'
import { MongoOwnershipTransferStore } from './services/mongo-ownership-transfer.store'
import { OwnershipTransferService } from './services/ownership-transfer.service'
import { OwnershipTransferResolver } from './services/ownership-transfer.resolver'
import { OWNERSHIP_TRANSFER_STORE } from './services/ownership-transfer.store'
import { PropertyOwnershipTransfer } from './schemas/property-ownership-transfer.schema'
import { PropertyOwnershipTransferRecord } from './schemas/property-ownership-transfer-record.schema'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contract,
      SigningGrant,
      DepositAgreement,
      Apartment,
      ContractSignedArtifact,
      ContractTemplate,
      ContractTemplateAudit,
      ContractArtifact,
      ContractAmendment,
      Payment,
      MoveInSettlement,
      ContractLayoutProfile,
      ContractLayoutAudit,
      User,
      Booking,
      Dispute,
      RentalApplication,
      PropertyOwnershipTransfer,
      PropertyOwnershipTransferRecord,
    ]),
    LegalModule,
    DigitalSignatureModule,
    FabricModule,
    UsersModule,
    EkycModule,
    PaymentsModule,
    AuthModule,
    NotificationsModule,
  ],
  controllers: [
    ContractsController,
    DepositAgreementsController,
    ContractTemplatesController,
    ContractCommercialEditorController,
    ContractAmendmentController,
    ContractLayoutsController,
    OwnershipTransferController,
  ],
  providers: [
    ContractsService,
    DepositAgreementsService,
    ContractArtifactService,
    ContractDocumentProjector,
    ContractViewService,
    SignedArtifactService,
    SmartCaSigningService,
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
    OwnershipTransferService,
    OwnershipTransferResolver,
    MongoOwnershipTransferStore,
    {
      provide: OWNERSHIP_TRANSFER_STORE,
      useExisting: MongoOwnershipTransferStore,
    },
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
    OwnershipTransferService,
    OwnershipTransferResolver,
  ],
})
export class ContractsModule {}
