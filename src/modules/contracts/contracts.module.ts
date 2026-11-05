import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { User } from '../users/schemas/user.schema'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Contract } from './schemas/contract.schema'
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
import { SmartCaSigningSession } from './schemas/smartca-signing-session.schema'
import { SmartCaProvider } from './providers/smartca.provider'
import { MockSmartCaProvider } from './providers/mock-smartca.provider'
import { SmartCaEventsGateway } from './gateways/smartca-events.gateway'
import { SMARTCA_EVENTS_PUBLISHER } from './gateways/smartca-events.publisher'
import { ContractTemplate } from './schemas/contract-template.schema'
import { ContractTemplateGovernanceService } from './legal/contract-template-governance.service'
import { ContractTemplatesController } from './legal/contract-templates.controller'
import { ContractDocument } from './schemas/contract-document.schema'
import { Payment } from '../payments/schemas/payment.schema'
import {
  CONTRACT_ARTIFACT_STORAGE,
  MongoGridFsArtifactStorage,
} from './services/contract-artifact.storage'
import { ContractCommercialEditorService } from './services/contract-commercial-editor.service'
import { ContractCommercialEditorController } from './controllers/contract-commercial-editor.controller'
import { ContractAmendmentService } from './services/contract-amendment.service'
import { ContractAmendmentStore } from './services/contract-amendment.store'
import { ContractAmendmentController } from './controllers/contract-amendment.controller'
import { ContractChangeRequestController } from './controllers/contract-change-request.controller'
import { ContractChangeRequestService } from './services/contract-change-request.service'
import { ContractChangeRequest } from './schemas/contract-change-request.schema'
import { DepositConfirmationResolver } from './services/deposit-confirmation.resolver'
import { FlowNotificationService } from './flow/flow-notification.service'
import { NotificationsModule } from '../notifications/notifications.module'
import { MoveInSettlement } from '../rental/schemas/move-in-settlement.schema'
import { MoveOutHandover } from '../rental/schemas/move-out-handover.schema'
import { DepositSettlementStatement } from '../rental/schemas/deposit-settlement-statement.schema'
import { ActivityLogModule } from '../activity-log/activity-log.module'
import { ContractLayoutService } from './layout/contract-layout.service'
import { ContractLayoutsController } from './layout/contract-layouts.controller'
import { SignedArtifactService } from './signed-artifact/signed-artifact.service'
import { ContractEvidencePackageService } from './services/contract-evidence-package.service'
import { ContractRecordsService } from './services/contract-records.service'
import { ContractEvidencePackageExportService } from './services/contract-evidence-package.export.service'
import { OwnershipTransferController } from './controllers/ownership-transfer.controller'
import { MongoOwnershipTransferStore } from './services/mongo-ownership-transfer.store'
import { OwnershipTransferService } from './services/ownership-transfer.service'
import { OwnershipTransferResolver } from './services/ownership-transfer.resolver'
import { OWNERSHIP_TRANSFER_STORE } from './services/ownership-transfer.store'
import { PropertyOwnershipTransfer } from './schemas/property-ownership-transfer.schema'
import { PropertyOwnershipTransferRecord } from './schemas/property-ownership-transfer-record.schema'
import { WalletsModule } from '../wallets/wallets.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contract,
      ContractChangeRequest,
      SmartCaSigningSession,
      DepositAgreement,
      Apartment,
      ContractTemplate,
      ContractDocument,
      Payment,
      MoveInSettlement,
      MoveOutHandover,
      DepositSettlementStatement,
      User,
      Booking,
      Dispute,
      RentalApplication,
      PropertyOwnershipTransfer,
      PropertyOwnershipTransferRecord,
    ]),
    LegalModule,
    FabricModule,
    ActivityLogModule,
    UsersModule,
    EkycModule,
    PaymentsModule,
    AuthModule,
    NotificationsModule,
    WalletsModule,
  ],
  controllers: [
    ContractsController,
    DepositAgreementsController,
    ContractTemplatesController,
    ContractCommercialEditorController,
    ContractAmendmentController,
    ContractChangeRequestController,
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
    // Adapter ký số SmartCA (trước đây ở DigitalSignatureModule): provider thật/mock theo cấu hình
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
    SmartCaEventsGateway,
    {
      provide: SMARTCA_EVENTS_PUBLISHER,
      useExisting: SmartCaEventsGateway,
    },
    ContractTemplateGovernanceService,
    ContractCommercialEditorService,
    ContractAmendmentService,
    ContractAmendmentStore,
    ContractChangeRequestService,
    DepositConfirmationResolver,
    {
      provide: CONTRACT_ARTIFACT_STORAGE,
      useClass: MongoGridFsArtifactStorage,
    },
    FlowNotificationService,
    ContractLayoutService,
    ContractEvidencePackageService,
    ContractRecordsService,
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
