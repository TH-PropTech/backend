import { isTestSignBypassEnabled } from './test-sign-bypass'

export const SIGNING_METHOD_IDS = [
  'smartca_v1',
  'smartca_v2',
  'dev_sign',
] as const

export type SigningMethodId = (typeof SIGNING_METHOD_IDS)[number]

const DEFAULT_ENABLED: SigningMethodId[] = ['smartca_v1']

/**
 * Tập phương thức ký được bật theo cấu hình backend (nguồn sự thật cho UI).
 * - SIGNING_METHODS (CSV) chọn tập thường; mặc định smartca_v1.
 * - smartca_v2 chỉ bật khi SMARTCA_V2_ENABLED=true (tắt mặc định).
 * - dev_sign chỉ bật khi test-sign bypass bật và không phải production.
 */
export function resolveEnabledSigningMethods(
  env: NodeJS.ProcessEnv = process.env
): SigningMethodId[] {
  const configured = (env['SIGNING_METHODS'] ?? '')
    .split(',')
    .map(value => value.trim())
    .filter((value): value is SigningMethodId =>
      (SIGNING_METHOD_IDS as readonly string[]).includes(value)
    )
  const base = new Set<SigningMethodId>(
    configured.length > 0 ? configured : DEFAULT_ENABLED
  )
  base.delete('smartca_v2')
  base.delete('dev_sign')
  if (env['SMARTCA_V2_ENABLED'] === 'true') base.add('smartca_v2')
  if (isTestSignBypassEnabled()) base.add('dev_sign')
  return SIGNING_METHOD_IDS.filter(id => base.has(id))
}

export function isSigningMethodEnabled(
  id: SigningMethodId,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return resolveEnabledSigningMethods(env).includes(id)
}
