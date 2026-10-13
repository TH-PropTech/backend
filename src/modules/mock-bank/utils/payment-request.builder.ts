import type { MockPaymentInit } from '../services/mock-bank.service'

export type PaymentPurpose =
  | 'DEPOSIT'
  | 'SETTLEMENT'
  | 'RENT'
  | 'PLATFORM_FEE'
  | 'DEPOSIT_TOPUP'

export type PaymentRequestLine = {
  kind: string
  description: string
  amountBeforeVat: number
  vatAmount: number
  amount: number
  paymentId: string
}

export type PaymentRequestView = MockPaymentInit & {
  invoiceCode: string
  purpose: PaymentPurpose
  lines: PaymentRequestLine[]
  total: number
  currency: 'VND'
  payer: { role: 'tenant' | 'landlord'; maskedName: string }
  payee: {
    role: 'landlord' | 'platform'
    displayName: string
    maskedAccountRef: string | null
  }
  transferContent: string
  dueAt: string | null
  simulation: boolean
  qrFormat: 'simulated'
}

type BuildPaymentRequestInput = {
  payment: MockPaymentInit
  invoiceCode: string
  purpose: PaymentPurpose
  lines: PaymentRequestLine[]
  payer: { role: 'tenant' | 'landlord'; name?: string | null }
  payee: {
    role: 'landlord' | 'platform'
    displayName?: string | null
    accountRef?: string | null
  }
  dueAt?: Date | string | null
  simulation: boolean
}

const normalizeBankText = (value: string): string =>
  value
    .replace(/[đĐ]/g, character => (character === 'đ' ? 'd' : 'D'))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

const normalizeInvoiceCode = (value: string): string =>
  normalizeBankText(value).replace(/ /g, '-')

const maskName = (value?: string | null): string => {
  const normalized = normalizeBankText(value ?? '')
  if (!normalized) return '***'
  return normalized
    .split(' ')
    .map(part => `${part.charAt(0)}***`)
    .join(' ')
}

const maskAccountRef = (value?: string | null): string | null => {
  const normalized = value?.trim()
  if (!normalized) return null
  const visible = normalized.slice(-4)
  return `${'*'.repeat(Math.max(4, normalized.length - visible.length))}${visible}`
}

export const buildPaymentRequest = (
  input: BuildPaymentRequestInput
): PaymentRequestView => {
  const normalizedInvoiceCode = normalizeInvoiceCode(input.invoiceCode)
  const transferContent = `TH ${normalizeBankText(normalizedInvoiceCode)}`
    .slice(0, 25)
    .trim()
  const total = input.lines.length
    ? input.lines.reduce((sum, line) => sum + line.amount, 0)
    : input.payment.amount

  return {
    ...input.payment,
    invoiceCode: normalizedInvoiceCode,
    purpose: input.purpose,
    lines: input.lines,
    total,
    currency: 'VND',
    payer: {
      role: input.payer.role,
      maskedName: maskName(input.payer.name),
    },
    payee: {
      role: input.payee.role,
      displayName: maskName(input.payee.displayName),
      maskedAccountRef: maskAccountRef(input.payee.accountRef),
    },
    transferContent,
    dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : null,
    simulation: input.simulation,
    qrFormat: 'simulated',
  }
}
