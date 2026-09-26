export const LEGAL_SOURCE_KINDS = ['procedure', 'legal_text'] as const
export type LegalSourceKind = (typeof LEGAL_SOURCE_KINDS)[number]

export const LEGAL_SOURCE_ICONS = [
  'residence',
  'tax',
  'law',
  'decree',
  'fire',
  'building',
  'digital',
] as const
export type LegalSourceIcon = (typeof LEGAL_SOURCE_ICONS)[number]

export const REGULATION_CATEGORIES = [
  'residence',
  'tax-finance',
  'fire-safety',
  'building-operations',
  'digital-legal',
  'deposit-handover',
] as const
export type RegulationCategory = (typeof REGULATION_CATEGORIES)[number]

export const REGULATION_SEVERITIES = [
  'mandatory',
  'recommended',
  'optional',
] as const
export type RegulationSeverity = (typeof REGULATION_SEVERITIES)[number]

export const PROPERTY_SCOPES = [
  'all',
  'apartment',
  'serviced-apartment',
  'villa-house',
  'room',
] as const
export type PropertyScope = (typeof PROPERTY_SCOPES)[number]

/** Key nguồn: bắt đầu bằng chữ/số thường, cho phép `.` và `-` (vd `1.004194`, `housing-law-2023`) */
export const LEGAL_SOURCE_KEY_PATTERN = /^[a-z0-9][a-z0-9.-]{1,63}$/

export interface DossierItem {
  title: string
  detail: string
  isPropTechExport?: boolean
}

export interface ExecutionStep {
  step: number
  title: string
  detail: string
}

export interface LegalGround {
  title: string
  article: string
  url?: string
}

export interface RegulationChecklistItem {
  id: string
  label: string
  hint?: string
}

export interface LegalSourceContent {
  code: string
  title: string
  subtitle: string
  agency: string
  duration: string
  fee: string
  externalUrl: string
  icon: LegalSourceIcon
  description: string
  dossierItems: DossierItem[]
  steps: ExecutionStep[]
  legalGrounds: LegalGround[]
  notes: string[]
}

export interface PlatformRegulationContent {
  code: string
  title: string
  summary: string
  category: RegulationCategory
  severity: RegulationSeverity
  scope: PropertyScope[]
  checklistItems: RegulationChecklistItem[]
  order: number
  isActive: boolean
  isDefault?: boolean
}
