import type { DepositStatementStatus } from '../../rental/schemas/deposit-settlement-statement.schema'
import type { MoveOutHandoverStatus } from '../../rental/schemas/move-out-handover.schema'
import type {
  ContractFlowActionDto,
  ContractFlowMoveOutDto,
  ContractFlowStageDto,
  MoveOutPhase,
} from '../dto/contract-view.dto'
import {
  evaluateAcknowledgeDepositRefund,
  evaluateCreateDepositStatement,
  evaluateRecordDepositRefund,
  evaluateRecordMoveOutHandover,
  evaluateRespondDepositStatement,
  evaluateRespondMoveOutHandover,
  type GuardResult,
} from './flow-guards'

/**
 * Giai đoạn kết thúc thuê được suy ra từ hai collection mới (design D6);
 * không bao giờ ghi hay đọc thêm giá trị `contract.status`.
 */
export interface MoveOutFacts {
  handoverStatus: MoveOutHandoverStatus | null
  statementStatus: DepositStatementStatus | null
  hasUnacknowledgedRefund: boolean
}

type MoveOutActor = 'tenant' | 'landlord' | 'staff'

/**
 * Quy tắc tạm (design Open Question 13): "chờ trả nhà" bắt đầu khi hợp đồng
 * `terminated`, hoặc khi đã có biên bản trả nhà chưa hoàn tất trên hợp đồng
 * `active`. Hợp đồng `active` chưa có biên bản thì chưa có giai đoạn.
 */
export function deriveMoveOutPhase(
  contractStatus: string,
  facts: MoveOutFacts | undefined
): MoveOutPhase | null {
  // facts vắng mặt = chưa nạp dữ liệu kết thúc thuê (khác với "đã nạp, chưa có bản ghi").
  if (!facts || contractStatus === 'cancelled') return null
  if (facts.statementStatus === 'closed') return 'settled'
  if (facts.handoverStatus === 'completed') {
    return 'awaiting-deposit-settlement'
  }
  if (contractStatus === 'terminated' || facts.handoverStatus) {
    return 'awaiting-move-out'
  }
  return null
}

export function projectMoveOut(
  contractStatus: string,
  facts: MoveOutFacts | undefined
): ContractFlowMoveOutDto | undefined {
  const phase = deriveMoveOutPhase(contractStatus, facts)
  if (!phase) return undefined
  return {
    phase,
    disputed:
      facts?.handoverStatus === 'disputed' ||
      facts?.statementStatus === 'disputed',
    handoverStatus: facts?.handoverStatus ?? null,
    statementStatus: facts?.statementStatus ?? null,
  }
}

/**
 * Hợp đồng đang thuê, đã xong biên bản nhận nhà, chưa có biên bản trả nhà:
 * chủ nhà phải có chỗ bắt đầu dù chưa có giai đoạn suy ra. Khớp điều kiện
 * của endpoint ghi biên bản (hợp đồng active hoặc terminated, đã có biên bản
 * nhận nhà hoàn tất).
 */
function canStartMoveOut(
  contractStatus: string,
  facts: MoveOutFacts | undefined,
  moveInHandoverCompleted: boolean
): boolean {
  return (
    facts !== undefined &&
    contractStatus === 'active' &&
    facts.handoverStatus === null &&
    moveInHandoverCompleted
  )
}

export function moveOutStage(
  contractStatus: string,
  facts: MoveOutFacts | undefined,
  moveInHandoverCompleted = false
): ContractFlowStageDto | null {
  const phase = deriveMoveOutPhase(contractStatus, facts)
  if (!phase) {
    return canStartMoveOut(contractStatus, facts, moveInHandoverCompleted)
      ? { key: 'move-out', status: 'upcoming', blockers: [], completedAt: null }
      : null
  }
  return {
    key: 'move-out',
    status: phase === 'settled' ? 'done' : 'active',
    blockers: [],
    completedAt: null,
  }
}

const toAction = (
  action: ContractFlowActionDto['action'],
  actorRole: MoveOutActor,
  guard: GuardResult
): ContractFlowActionDto => ({
  action,
  actorRole,
  enabled: guard.enabled,
  reasonCode: guard.reasonCode,
  stage: 'move-out',
})

/** Hành động kết thúc thuê theo giai đoạn và vai trò; nhân viên chỉ xem. */
export function moveOutActions(
  contractStatus: string,
  facts: MoveOutFacts | undefined,
  role: MoveOutActor,
  moveInHandoverCompleted = false
): ContractFlowActionDto[] {
  const phase = deriveMoveOutPhase(contractStatus, facts)
  if (!phase) {
    return role === 'landlord' &&
      canStartMoveOut(contractStatus, facts, moveInHandoverCompleted)
      ? [
          toAction(
            'RECORD_MOVE_OUT_HANDOVER',
            role,
            evaluateRecordMoveOutHandover(null)
          ),
        ]
      : []
  }
  if (phase === 'settled' || role === 'staff') return []
  const handover = facts?.handoverStatus ?? null
  const statement = facts?.statementStatus ?? null
  if (role === 'landlord') {
    return phase === 'awaiting-move-out'
      ? [
          toAction(
            'RECORD_MOVE_OUT_HANDOVER',
            role,
            evaluateRecordMoveOutHandover(handover)
          ),
        ]
      : [
          toAction(
            'CREATE_DEPOSIT_STATEMENT',
            role,
            evaluateCreateDepositStatement(handover, statement)
          ),
          toAction(
            'RECORD_DEPOSIT_REFUND',
            role,
            evaluateRecordDepositRefund(statement)
          ),
        ]
  }
  if (phase === 'awaiting-move-out') {
    const guard = evaluateRespondMoveOutHandover(handover)
    return [
      toAction('CONFIRM_MOVE_OUT_HANDOVER', role, guard),
      toAction('REPORT_MOVE_OUT_DISCREPANCY', role, guard),
    ]
  }
  return [
    toAction(
      'RESPOND_DEPOSIT_STATEMENT',
      role,
      evaluateRespondDepositStatement(statement)
    ),
    toAction(
      'ACKNOWLEDGE_DEPOSIT_REFUND',
      role,
      evaluateAcknowledgeDepositRefund(facts?.hasUnacknowledgedRefund ?? false)
    ),
  ]
}
