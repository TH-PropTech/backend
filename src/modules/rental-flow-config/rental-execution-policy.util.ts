import { createHash } from 'node:crypto'

export const RENTAL_EXECUTION_STRATEGIES = [
  'DEPOSIT_FIRST',
  'SIGN_FIRST',
] as const

export type RentalExecutionStrategy =
  (typeof RENTAL_EXECUTION_STRATEGIES)[number]

export type RentalExecutionPolicyStatus = 'draft' | 'published' | 'archived'

export interface RentalExecutionPolicyRef {
  policyId: string
  version: number
  strategy: RentalExecutionStrategy
  contentHash: string
}

export interface RentalExecutionPolicyDisclosure {
  sequenceLabel: string
  depositLabel: string
  effectivenessLabel: string
  cancellationLabel: string
}

export function isRentalExecutionStrategy(
  value: unknown
): value is RentalExecutionStrategy {
  return (
    typeof value === 'string' &&
    (RENTAL_EXECUTION_STRATEGIES as readonly string[]).includes(value)
  )
}

export function computeRentalExecutionPolicyHash(input: {
  policyId: string
  strategy: RentalExecutionStrategy
  name: string
  description: string
  disclosure: RentalExecutionPolicyDisclosure
  version: number
}): string {
  const payload = JSON.stringify({
    policyId: input.policyId.trim(),
    strategy: input.strategy,
    name: input.name.trim(),
    description: input.description.trim(),
    disclosure: {
      cancellationLabel: input.disclosure.cancellationLabel.trim(),
      depositLabel: input.disclosure.depositLabel.trim(),
      effectivenessLabel: input.disclosure.effectivenessLabel.trim(),
      sequenceLabel: input.disclosure.sequenceLabel.trim(),
    },
    version: input.version,
  })
  return createHash('sha256').update(payload).digest('hex')
}

export const DEFAULT_RENTAL_EXECUTION_POLICY_INPUTS = [
  {
    policyId: 'deposit-first',
    strategy: 'DEPOSIT_FIRST' as const,
    name: 'Cọc trước, ký sau',
    description:
      'Xác nhận khoản cọc trước, sau đó tenant và landlord ký cùng canonical contract artifact.',
    disclosure: {
      sequenceLabel: 'Xác nhận cọc trước rồi mới ký hợp đồng số.',
      depositLabel: 'Khoản cọc phải được xác nhận trước khi mở phiên ký.',
      effectivenessLabel:
        'Hợp đồng có hiệu lực khi đã xác nhận cọc và đủ hai chữ ký SmartCA.',
      cancellationLabel:
        'Quy tắc hoàn/hủy cọc áp dụng theo thỏa thuận cọc đã snapshot.',
    },
  },
  {
    policyId: 'sign-first',
    strategy: 'SIGN_FIRST' as const,
    name: 'Ký trước, cọc sau',
    description:
      'Hai bên ký canonical contract artifact trước; hợp đồng chỉ có hiệu lực sau khi khoản cọc được xác nhận.',
    disclosure: {
      sequenceLabel: 'Hai bên ký hợp đồng số trước rồi mới xác nhận cọc.',
      depositLabel: 'Có thể ký khi cọc chưa xác nhận; chưa được kích hoạt.',
      effectivenessLabel:
        'Hợp đồng ở trạng thái chờ cọc cho đến khi đủ hai chữ ký và đã xác nhận cọc.',
      cancellationLabel:
        'Quy tắc hoàn/hủy cọc áp dụng theo thỏa thuận cọc đã snapshot.',
    },
  },
] as const

export function getDefaultRentalExecutionPolicyRef(): RentalExecutionPolicyRef {
  const input = DEFAULT_RENTAL_EXECUTION_POLICY_INPUTS[0]
  return {
    policyId: input.policyId,
    version: 1,
    strategy: input.strategy,
    contentHash: computeRentalExecutionPolicyHash({
      ...input,
      version: 1,
    }),
  }
}
