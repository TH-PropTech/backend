import { Test } from '@nestjs/testing'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Reflector } from '@nestjs/core'
import { FabricController } from './fabric.controller'
import { FabricService } from './fabric.service'
import { LedgerOutboxService } from './ledger-outbox.service'
import { FabricGovernanceService } from './fabric-governance.service'
import { LedgerAuditQueryService } from './ledger-audit-query.service'
import { LedgerReconciliationService } from './ledger-reconciliation.service'
import { BlockchainLog } from './schemas/blockchain-log.schema'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'

describe('OpenAPI contract for governance routes (PROP-399 task 4.4)', () => {
  it('documents the four governance operations with their request/response schemas', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FabricController],
      providers: [
        { provide: FabricService, useValue: {} },
        { provide: LedgerOutboxService, useValue: {} },
        { provide: FabricGovernanceService, useValue: {} },
        { provide: LedgerAuditQueryService, useValue: {} },
        { provide: LedgerReconciliationService, useValue: {} },
        { provide: getRepositoryToken(BlockchainLog), useValue: {} },
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile()
    const app = moduleRef.createNestApplication()
    await app.init()

    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build()
    )
    await app.close()

    const paths = document.paths
    const publish = paths['/fabric/governance-snapshots/publish']?.post
    const list = paths['/fabric/governance-snapshots']?.get
    const detail = paths['/fabric/governance-snapshots/{id}']?.get
    const verify = paths['/fabric/governance-snapshots/{id}/verify']?.get

    expect(publish?.responses).toHaveProperty('201')
    expect(publish?.responses).toHaveProperty('200')
    expect(publish?.responses).toHaveProperty('422')
    expect(publish?.responses).toHaveProperty('403')
    expect(list?.responses).toHaveProperty('200')
    expect(
      (list?.parameters as Array<{ name: string }> | undefined)?.map(
        p => p.name
      )
    ).toEqual(expect.arrayContaining(['page', 'limit']))
    expect(detail?.responses).toHaveProperty('404')
    expect(verify?.responses).toHaveProperty('200')
    expect(verify?.responses).toHaveProperty('404')

    const overview = paths['/fabric/audit/overview']?.get
    const events = paths['/fabric/audit/events']?.get
    const eventDetail = paths['/fabric/audit/events/{id}']?.get
    expect(overview?.responses).toHaveProperty('200')
    expect(overview?.responses).toHaveProperty('403')
    expect(events?.responses).toHaveProperty('200')
    expect(events?.responses).toHaveProperty('400')
    expect(
      (events?.parameters as Array<{ name: string }> | undefined)?.map(
        p => p.name
      )
    ).toEqual(
      expect.arrayContaining([
        'page',
        'limit',
        'contractId',
        'eventType',
        'state',
        'verificationState',
        'from',
        'to',
        'txId',
      ])
    )
    expect(eventDetail?.responses).toHaveProperty('404')

    const startRun = paths['/fabric/reconciliation-runs']?.post
    const listRuns = paths['/fabric/reconciliation-runs']?.get
    const runDetail = paths['/fabric/reconciliation-runs/{id}']?.get
    const findings = paths['/fabric/reconciliation-runs/{id}/findings']?.get
    const resume = paths['/fabric/reconciliation-runs/{id}/resume']?.post
    const cancel = paths['/fabric/reconciliation-runs/{id}/cancel']?.post
    const repair = paths['/fabric/reconciliation-findings/{id}/repair']?.post
    expect(startRun?.responses).toHaveProperty('201')
    expect(startRun?.responses).toHaveProperty('400')
    expect(startRun?.responses).toHaveProperty('409')
    expect(startRun?.responses).toHaveProperty('403')
    expect(listRuns?.responses).toHaveProperty('200')
    expect(runDetail?.responses).toHaveProperty('404')
    expect(
      (findings?.parameters as Array<{ name: string }> | undefined)?.map(
        p => p.name
      )
    ).toEqual(expect.arrayContaining(['page', 'limit', 'category', 'status']))
    expect(resume?.responses).toHaveProperty('409')
    expect(cancel?.responses).toHaveProperty('409')
    expect(repair?.responses).toHaveProperty('409')
    expect(repair?.responses).toHaveProperty('404')

    const schemas = document.components?.schemas ?? {}
    expect(schemas).toHaveProperty('ReconciliationRunResponseDto')
    expect(schemas).toHaveProperty('ReconciliationFindingResponseDto')
    expect(schemas).toHaveProperty('RepairFindingResponseDto')
    expect(schemas).toHaveProperty('StartReconciliationRunDto')
    expect(schemas).toHaveProperty('AuditOverviewResponseDto')
    expect(schemas).toHaveProperty('AuditEventDetailResponseDto')
    expect(schemas).toHaveProperty('AuditEventsPageResponseDto')
    expect(schemas).toHaveProperty('GovernanceSnapshotResponseDto')
    expect(schemas).toHaveProperty('GovernanceVerificationResponseDto')
    expect(schemas).toHaveProperty('PublishGovernanceSnapshotResponseDto')
    expect(schemas).toHaveProperty('GovernanceSnapshotPageResponseDto')
    const verification = schemas.GovernanceVerificationResponseDto as {
      properties: { status: { enum: string[] } }
    }
    expect(verification.properties.status.enum).toEqual([
      'verified',
      'mismatch',
      'unavailable',
      'not-recorded',
    ])
  })
})
