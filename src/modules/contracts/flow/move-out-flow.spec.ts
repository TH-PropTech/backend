import type { ContractFlowActionDto } from '../dto/contract-view.dto'
import {
  projectContractFlow,
  type ContractFlowFacts,
} from './contract-flow.projector'

const at = (iso: string): Date => new Date(iso)
type MoveOut = NonNullable<ContractFlowFacts['moveOut']>
const asLandlord = { isTenant: false, isLandlord: true, isStaff: false }
const asTenant = { isTenant: true, isLandlord: false, isStaff: false }
const asStaff = { isTenant: false, isLandlord: false, isStaff: true }

const facts = (
  status: string,
  moveOut?: MoveOut,
  viewer = asTenant
): ContractFlowFacts => ({
  contractStatus: status,
  executionMethod: 'POC_ECONSENT',
  isConfigOutdated: false,
  agreement: {
    status: 'paid',
    hasConsent: true,
    consentedAt: at('2026-09-20T01:00:00Z'),
    contentRevision: 1,
    contentHash: 'h',
  },
  deposit: {
    required: true,
    confirmed: true,
    paidAt: at('2026-09-21T00:00:00Z'),
  },
  contentLockedAt: at('2026-09-21T01:00:00Z'),
  hasArtifact: false,
  signatures: {
    tenant: { signed: true, signedAt: at('2026-09-22T01:00:00Z') },
    landlord: { signed: true, signedAt: at('2026-09-22T02:00:00Z') },
  },
  kycVerified: { tenant: true, landlord: true },
  activationFailureCode: null,
  ledger: {
    status: 'confirmed-fabric',
    recordedAt: at('2026-09-23T01:00:00Z'),
  },
  viewer,
  ...(moveOut ? { moveOut } : {}),
})

const mo = (
  handoverStatus: MoveOut['handoverStatus'],
  statementStatus: MoveOut['statementStatus'] = null,
  hasUnacknowledgedRefund = false
): MoveOut => ({ handoverStatus, statementStatus, hasUnacknowledgedRefund })

const flowOf = (
  status: string,
  moveOut?: MoveOut,
  viewer = asTenant
): ReturnType<typeof projectContractFlow> =>
  projectContractFlow(facts(status, moveOut, viewer))
const action = (
  flow: ReturnType<typeof projectContractFlow>,
  key: string
): ContractFlowActionDto | undefined =>
  flow.nextActions.find(candidate => candidate.action === key)
const moveOutActionsOf = (
  flow: ReturnType<typeof projectContractFlow>
): ContractFlowActionDto[] =>
  flow.nextActions.filter(candidate => candidate.stage === 'move-out')

describe('projectContractFlow — move-out phases (derived, no new contract.status)', () => {
  it('terminated contract whose move-out data was not loaded has no phase', () => {
    expect(flowOf('terminated').moveOut).toBeUndefined()
  })

  it('active contract without records has no move-out phase or stage', () => {
    const flow = flowOf('active', mo(null))
    expect(flow.moveOut).toBeUndefined()
    expect(flow.stages.map(s => s.key)).not.toContain('move-out')
  })

  it('terminated contract without records is awaiting-move-out; landlord may record', () => {
    const flow = flowOf('terminated', mo(null), asLandlord)
    expect(flow.moveOut).toEqual({
      phase: 'awaiting-move-out',
      disputed: false,
      handoverStatus: null,
      statementStatus: null,
    })
    expect(flow.activeStage).toBe('move-out')
    expect(action(flow, 'RECORD_MOVE_OUT_HANDOVER')?.enabled).toBe(true)
    expect(action(flow, 'CREATE_DEPOSIT_STATEMENT')).toBeUndefined()
  })

  it('active contract with an uncompleted handover is awaiting-move-out', () => {
    expect(flowOf('active', mo('recorded')).moveOut?.phase).toBe(
      'awaiting-move-out'
    )
  })

  it('tenant can confirm and report a discrepancy while recorded, never record', () => {
    const flow = flowOf('terminated', mo('recorded'))
    expect(action(flow, 'CONFIRM_MOVE_OUT_HANDOVER')?.enabled).toBe(true)
    expect(action(flow, 'REPORT_MOVE_OUT_DISCREPANCY')?.enabled).toBe(true)
    expect(action(flow, 'RECORD_MOVE_OUT_HANDOVER')).toBeUndefined()
  })

  it('tenant actions are disabled with the endpoint reason code when disputed', () => {
    const flow = flowOf('terminated', mo('disputed'))
    expect(flow.moveOut?.disputed).toBe(true)
    expect(action(flow, 'CONFIRM_MOVE_OUT_HANDOVER')).toMatchObject({
      enabled: false,
      reasonCode: 'MOVE_OUT_HANDOVER_DISPUTED',
    })
  })

  it('tenant confirm is disabled while the landlord has not recorded', () => {
    expect(
      action(flowOf('terminated', mo(null)), 'CONFIRM_MOVE_OUT_HANDOVER')
    ).toMatchObject({
      enabled: false,
      reasonCode: 'MOVE_OUT_HANDOVER_NOT_FOUND',
    })
  })

  it('landlord cannot revise a completed or disputed handover', () => {
    const disputed = flowOf('terminated', mo('disputed'), asLandlord)
    expect(action(disputed, 'RECORD_MOVE_OUT_HANDOVER')).toMatchObject({
      enabled: false,
      reasonCode: 'MOVE_OUT_HANDOVER_DISPUTED',
    })
  })

  it('landlord cannot create a statement while the handover is only recorded', () => {
    const flow = flowOf('terminated', mo('recorded'), asLandlord)
    expect(action(flow, 'CREATE_DEPOSIT_STATEMENT')).toBeUndefined()
    expect(action(flow, 'RECORD_MOVE_OUT_HANDOVER')?.enabled).toBe(true)
  })

  it('completed handover => awaiting-deposit-settlement; statement allowed, refund not yet', () => {
    const flow = flowOf('terminated', mo('completed'), asLandlord)
    expect(flow.moveOut?.phase).toBe('awaiting-deposit-settlement')
    expect(action(flow, 'CREATE_DEPOSIT_STATEMENT')?.enabled).toBe(true)
    expect(action(flow, 'RECORD_DEPOSIT_REFUND')).toMatchObject({
      enabled: false,
      reasonCode: 'STATEMENT_REFUND_NOT_ALLOWED',
    })
  })

  it('draft statement keeps create enabled; a submitted one disables it', () => {
    expect(
      action(
        flowOf('terminated', mo('completed', 'draft'), asLandlord),
        'CREATE_DEPOSIT_STATEMENT'
      )?.enabled
    ).toBe(true)
    expect(
      action(
        flowOf('terminated', mo('completed', 'awaiting-tenant'), asLandlord),
        'CREATE_DEPOSIT_STATEMENT'
      )
    ).toMatchObject({ enabled: false, reasonCode: 'STATEMENT_NOT_DRAFT' })
  })

  it.each(['accepted', 'disputed', 'refund-recorded'] as const)(
    'landlord can record a refund when the statement is %s',
    statementStatus => {
      const flow = flowOf(
        'terminated',
        mo('completed', statementStatus),
        asLandlord
      )
      expect(action(flow, 'RECORD_DEPOSIT_REFUND')?.enabled).toBe(true)
      expect(flow.moveOut?.phase).toBe('awaiting-deposit-settlement')
    }
  )

  it('disputed statement keeps the phase and flags disputed', () => {
    expect(
      flowOf('terminated', mo('completed', 'disputed')).moveOut
    ).toMatchObject({ phase: 'awaiting-deposit-settlement', disputed: true })
  })

  it('tenant responds only when awaiting-tenant and acknowledges only with an unacknowledged refund', () => {
    const waiting = flowOf('terminated', mo('completed', 'awaiting-tenant'))
    expect(action(waiting, 'RESPOND_DEPOSIT_STATEMENT')?.enabled).toBe(true)
    expect(action(waiting, 'ACKNOWLEDGE_DEPOSIT_REFUND')).toMatchObject({
      enabled: false,
      reasonCode: 'STATEMENT_NO_REFUND_TO_ACKNOWLEDGE',
    })
    const refunded = flowOf(
      'terminated',
      mo('completed', 'refund-recorded', true)
    )
    expect(action(refunded, 'ACKNOWLEDGE_DEPOSIT_REFUND')?.enabled).toBe(true)
    expect(action(refunded, 'RESPOND_DEPOSIT_STATEMENT')).toMatchObject({
      enabled: false,
      reasonCode: 'STATEMENT_NOT_AWAITING_TENANT',
    })
  })

  it('closed statement => settled, stage done, no move-out actions', () => {
    const flow = flowOf('terminated', mo('completed', 'closed'), asLandlord)
    expect(flow.moveOut?.phase).toBe('settled')
    expect(flow.stages.find(s => s.key === 'move-out')?.status).toBe('done')
    expect(flow.activeStage).toBe('completed')
    expect(moveOutActionsOf(flow)).toEqual([])
  })

  it('staff sees the phase but gets no move-out actions', () => {
    const flow = flowOf('terminated', mo('recorded'), asStaff)
    expect(flow.moveOut?.phase).toBe('awaiting-move-out')
    expect(moveOutActionsOf(flow)).toEqual([])
  })

  it('cancelled contract never has a move-out phase', () => {
    expect(flowOf('cancelled', mo('recorded')).moveOut).toBeUndefined()
  })
})
