export const PUBLIC_SERVICE_PURPOSE = 'temporary-residence' as const
export const PUBLIC_SERVICE_OFFICIAL_SOURCE_URL =
  'https://dichvucong.bocongan.gov.vn/'

export type PublicServiceChecklistPurpose =
  | typeof PUBLIC_SERVICE_PURPOSE
  | 'permanent-residence'

type ChecklistContract = {
  executionMethod?:
    | 'WET_INK'
    | 'QUALIFIED_DIGITAL_SIGNATURE'
    | 'SMARTCA'
    | 'POC_ECONSENT'
  notarizationStatus?:
    | 'not-requested'
    | 'pending'
    | 'notarized'
    | 'authenticated'
    | 'rejected'
  contentLockedHash?: string | null
  signedByTenant?: boolean
  signedByLandlord?: boolean
}

export type PublicServiceChecklistItem = {
  id:
    | 'locked-contract-copy'
    | 'signing-evidence'
    | 'notarization-or-authentication'
  status: 'available' | 'required-before-submission' | 'evidence-present'
  required: boolean
}

export type PublicServiceChecklist = {
  purpose: PublicServiceChecklistPurpose
  externalProcedureCompleted: false
  officialSourceUrl: typeof PUBLIC_SERVICE_OFFICIAL_SOURCE_URL
  executionMethod: NonNullable<ChecklistContract['executionMethod']>
  notarizationStatus: NonNullable<ChecklistContract['notarizationStatus']>
  disclaimer: string
  items: PublicServiceChecklistItem[]
}

export function parsePublicServiceChecklistPurpose(
  value: unknown
): PublicServiceChecklistPurpose {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('PUBLIC_SERVICE_PURPOSE_REQUIRED')
  }
  if (value !== PUBLIC_SERVICE_PURPOSE && value !== 'permanent-residence') {
    throw new Error('PUBLIC_SERVICE_PURPOSE_UNSUPPORTED')
  }
  return PUBLIC_SERVICE_PURPOSE
}

export function buildPublicServiceChecklist(
  contract: ChecklistContract
): PublicServiceChecklist {
  const executionMethod = contract.executionMethod ?? 'POC_ECONSENT'
  const notarizationStatus = contract.notarizationStatus ?? 'not-requested'
  const hasLockedSignedContract = Boolean(
    contract.contentLockedHash &&
    contract.signedByTenant &&
    contract.signedByLandlord
  )
  const hasNotarizationEvidence =
    notarizationStatus === 'notarized' || notarizationStatus === 'authenticated'

  return {
    purpose: PUBLIC_SERVICE_PURPOSE,
    externalProcedureCompleted: false,
    officialSourceUrl: PUBLIC_SERVICE_OFFICIAL_SOURCE_URL,
    executionMethod,
    notarizationStatus,
    disclaimer:
      executionMethod === 'POC_ECONSENT'
        ? 'Ký xác nhận ở chế độ thử nghiệm không phải chữ ký số có chứng thư và không thay thế công chứng/chứng thực.'
        : 'Hệ thống chỉ xuất checklist và bằng chứng hiện có; không tự nộp hoặc xác nhận thủ tục bên ngoài.',
    items: [
      {
        id: 'locked-contract-copy',
        status: hasLockedSignedContract
          ? 'available'
          : 'required-before-submission',
        required: true,
      },
      {
        id: 'signing-evidence',
        status: hasLockedSignedContract
          ? 'available'
          : 'required-before-submission',
        required: true,
      },
      {
        id: 'notarization-or-authentication',
        status: hasNotarizationEvidence
          ? 'evidence-present'
          : 'required-before-submission',
        required: true,
      },
    ],
  }
}
