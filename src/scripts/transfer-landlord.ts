/* eslint-disable no-console */
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import {
  OwnershipTransferService,
  type OwnershipTransferSummaryResponse,
} from '../modules/contracts/services/ownership-transfer.service'
import {
  parseTransferLandlordArgs,
  type TransferLandlordArgs,
} from './transfer-landlord.args'

async function bootstrap(args: TransferLandlordArgs): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const service = app.get(OwnershipTransferService)

    if (!args.apply) {
      const preview = await service.preview(args.targetEmail, args.initiatedBy)
      console.log(
        JSON.stringify(
          {
            mode: 'preview',
            transferId: preview.transferId,
            targetUser: preview.targetUser,
            affectedCounts: preview.affectedCounts,
            immutableCounts: preview.immutableCounts,
            conflicts: preview.conflicts,
            previewHash: preview.previewHash,
            expiresAt: preview.expiresAt,
          },
          null,
          2
        )
      )
      return
    }

    const summary: OwnershipTransferSummaryResponse = await service.apply(
      args.transferId,
      { previewHash: args.previewHash },
      args.idempotencyKey
    )
    console.log(JSON.stringify({ mode: 'apply', ...summary }, null, 2))
  } finally {
    await app.close()
  }
}

function printUsage(): void {
  console.log(`Usage:
  pnpm transfer-landlord -- [--target <email>] [--initiated-by <id>]
  pnpm transfer-landlord -- --apply --transfer-id <id> --preview-hash <hash> --idempotency-key <key>

The default command only creates a redacted preview. It never changes ownership.
`)
}

try {
  const args = parseTransferLandlordArgs(process.argv.slice(2))
  if (args.help) {
    printUsage()
  } else {
    void bootstrap(args).catch(error => {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error(`transfer-landlord failed: ${message}`)
      process.exitCode = 1
    })
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Invalid arguments'
  console.error(message)
  printUsage()
  process.exitCode = 1
}
