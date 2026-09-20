export interface TransferLandlordArgs {
  readonly apply: boolean
  readonly help: boolean
  readonly targetEmail: string
  readonly initiatedBy: string
  readonly transferId: string
  readonly previewHash: string
  readonly idempotencyKey: string
}

const DEFAULT_TARGET_EMAIL = 'tongthachlaptrinh@gmail.com'
const DEFAULT_INITIATED_BY = 'manual-transfer-script'

export function parseTransferLandlordArgs(
  argv: readonly string[]
): TransferLandlordArgs {
  let apply = false
  let help = false
  let targetEmail = DEFAULT_TARGET_EMAIL
  let initiatedBy = DEFAULT_INITIATED_BY
  let transferId = ''
  let previewHash = ''
  let idempotencyKey = ''

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument) continue

    if (argument === '--') continue

    if (argument === '--apply') {
      apply = true
      continue
    }
    if (argument === '--help' || argument === '-h') {
      help = true
      continue
    }

    const [option, inlineValue] = argument.split('=', 2)
    const value = inlineValue ?? argv[++index]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${option}`)
    }

    switch (option) {
      case '--target':
        targetEmail = value
        break
      case '--initiated-by':
        initiatedBy = value
        break
      case '--transfer-id':
        transferId = value
        break
      case '--preview-hash':
        previewHash = value
        break
      case '--idempotency-key':
        idempotencyKey = value
        break
      default:
        throw new Error(`Unknown option: ${option}`)
    }
  }

  if (help) {
    return {
      apply,
      help,
      targetEmail,
      initiatedBy,
      transferId,
      previewHash,
      idempotencyKey,
    }
  }

  if (apply && (!transferId || !previewHash || !idempotencyKey)) {
    throw new Error(
      '--apply requires --transfer-id, --preview-hash, and --idempotency-key'
    )
  }

  return {
    apply,
    help,
    targetEmail,
    initiatedBy,
    transferId,
    previewHash,
    idempotencyKey,
  }
}
