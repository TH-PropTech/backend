import { ObjectId } from 'mongodb'
import type { MigrationOptions, MigrationReport } from './migration.types'

export const DEVICE_BINDINGS_EMBED_MIGRATION_ID = '007-device-bindings-embed'

export type LegacyDeviceBinding = {
  _id: ObjectId
  userId: string
  deviceId: string
  deviceName: string
  publicKey: string
  status: string
  createdAt?: Date
  updatedAt?: Date
}

export type EmbeddedDevice = {
  /** `_id` cũ của `device_bindings` (thiết bị bind sau khi chuyển code có thể không có). */
  bindingId?: ObjectId
  deviceId: string
  deviceName: string
  publicKey: string
  status: string
  createdAt: Date
  updatedAt: Date
}

export type UserSmartOtpDoc = {
  _id: ObjectId
  smartOTP?: { registeredDevices?: number; devices?: EmbeddedDevice[] } | null
}

export interface DeviceBindingsMigrationDb {
  /** Collection `device_bindings` (chỉ đọc; không bị xóa/sửa). */
  readBindings(): Promise<LegacyDeviceBinding[]>
  /** Các user có `smartOTP.devices[]` không rỗng (dùng cho rollback). */
  readUsersWithDevices(): Promise<UserSmartOtpDoc[]>
  /**
   * Upsert `device_bindings` theo `(userId, deviceId)`: cập nhật
   * deviceName/publicKey/status/updatedAt; chỉ khi chèn mới mới đặt `_id`/createdAt.
   */
  upsertBinding(binding: LegacyDeviceBinding): Promise<void>
  findUser(id: ObjectId): Promise<UserSmartOtpDoc | null>
  /** `users.updateOne` với toán tử nguyên tử; trả số document khớp bộ lọc. */
  updateUser(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ matchedCount: number }>
}

export type DeviceBindingsMigrationReport = MigrationReport & {
  /** Số thiết bị đã/sẽ được nhúng. */
  embedded: number
  /** Số user được backfill smartOTP mặc định. */
  backfilledUsers: number
  /** Binding có userId không còn user: bỏ qua, không tính vào kiểm đếm. */
  orphans: string[]
  /** Sau khi áp dụng: tổng số deviceId nguồn (khử trùng) và số tìm thấy trong users. */
  expectedDevices: number
  verifiedDevices: number
}

function defaultSmartOtp(): Record<string, unknown> {
  return {
    enabled: false,
    maxDevices: 1,
    registeredDevices: 0,
    otpAttempts: 0,
    devices: [] as EmbeddedDevice[],
  }
}

function newReport(
  dryRun: boolean,
  id = DEVICE_BINDINGS_EMBED_MIGRATION_ID
): DeviceBindingsMigrationReport {
  return {
    migrationId: id,
    scanned: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    dryRun,
    embedded: 0,
    backfilledUsers: 0,
    orphans: [],
    expectedDevices: 0,
    verifiedDevices: 0,
  }
}

/** Gom theo user và khử trùng (userId, deviceId): giữ bản có updatedAt mới nhất. */
function groupByUser(
  bindings: LegacyDeviceBinding[]
): Map<string, Map<string, LegacyDeviceBinding>> {
  const byUser = new Map<string, Map<string, LegacyDeviceBinding>>()
  for (const b of bindings) {
    const devices =
      byUser.get(b.userId) ?? new Map<string, LegacyDeviceBinding>()
    const prev = devices.get(b.deviceId)
    if (
      !prev ||
      (b.updatedAt?.getTime() ?? 0) >= (prev.updatedAt?.getTime() ?? 0)
    ) {
      devices.set(b.deviceId, b)
    }
    byUser.set(b.userId, devices)
  }
  return byUser
}

function toEmbedded(b: LegacyDeviceBinding): EmbeddedDevice {
  const now = new Date()
  return {
    bindingId: b._id,
    deviceId: b.deviceId,
    deviceName: b.deviceName,
    publicKey: b.publicKey,
    status: b.status,
    createdAt: b.createdAt ?? now,
    updatedAt: b.updatedAt ?? b.createdAt ?? now,
  }
}

function parseId(userId: string): ObjectId | null {
  return ObjectId.isValid(userId) ? new ObjectId(userId) : null
}

/**
 * Sao `device_bindings` -> `users.smartOTP.devices[]`.
 * - dry-run mặc định (chỉ ghi khi `dryRun === false`);
 * - idempotent theo deviceId ($push chỉ khi chưa có deviceId trong mảng);
 * - backfill smartOTP mặc định cho user thiếu;
 * - kiểm đếm sau khi áp dụng, lệch thì ném lỗi;
 * - không xóa/sửa collection nguồn.
 */
export async function migrateDeviceBindingsToUsers(
  db: DeviceBindingsMigrationDb,
  options: MigrationOptions = {}
): Promise<DeviceBindingsMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(dryRun)
  const bindings = await db.readBindings()
  report.scanned = bindings.length
  const byUser = groupByUser(bindings)
  const unique = [...byUser.values()].reduce((n, m) => n + m.size, 0)
  report.skipped += bindings.length - unique // bản ghi trùng (userId, deviceId)

  const verifyTargets: Array<[ObjectId, string[]]> = []

  for (const [userId, devices] of byUser) {
    const oid = parseId(userId)
    const user = oid ? await db.findUser(oid) : null
    if (!oid || !user) {
      report.orphans.push(userId)
      report.skipped += devices.size
      continue
    }

    if (!user.smartOTP) {
      report.backfilledUsers += 1
      if (!dryRun) {
        await db.updateUser(
          {
            _id: oid,
            $or: [{ smartOTP: { $exists: false } }, { smartOTP: null }],
          },
          { $set: { smartOTP: defaultSmartOtp() } }
        )
      }
    } else if (!user.smartOTP.devices && !dryRun) {
      await db.updateUser(
        { _id: oid, 'smartOTP.devices': { $exists: false } },
        { $set: { 'smartOTP.devices': [] } }
      )
    }

    const existing = new Set(
      (user.smartOTP?.devices ?? []).map(d => d.deviceId)
    )
    for (const binding of devices.values()) {
      if (existing.has(binding.deviceId)) {
        report.skipped += 1
        continue
      }
      report.embedded += 1
      report.updated += 1
      if (!dryRun) {
        const result = await db.updateUser(
          { _id: oid, 'smartOTP.devices.deviceId': { $ne: binding.deviceId } },
          {
            $push: { 'smartOTP.devices': toEmbedded(binding) },
            $inc: { 'smartOTP.registeredDevices': 1 },
          }
        )
        if (result.matchedCount === 0) {
          report.embedded -= 1
          report.updated -= 1
          report.skipped += 1 // luồng khác vừa thêm cùng deviceId
        }
      }
    }
    verifyTargets.push([oid, [...devices.keys()]])
  }

  report.expectedDevices = verifyTargets.reduce(
    (n, [, ids]) => n + ids.length,
    0
  )

  if (!dryRun) {
    for (const [oid, ids] of verifyTargets) {
      const user = await db.findUser(oid)
      const present = new Set(
        (user?.smartOTP?.devices ?? []).map(d => d.deviceId)
      )
      for (const id of ids) {
        if (present.has(id)) report.verifiedDevices += 1
        else
          report.errors.push(`${oid.toHexString()}:${id} missing after migrate`)
      }
    }
    if (report.verifiedDevices !== report.expectedDevices) {
      throw new Error(
        `${DEVICE_BINDINGS_EMBED_MIGRATION_ID}: count mismatch ` +
          `(expected ${report.expectedDevices}, found ${report.verifiedDevices})`
      )
    }
  }

  return report
}

/**
 * Hoàn tác: sao ngược MỌI thiết bị trong `users.smartOTP.devices[]` về
 * `device_bindings` (upsert theo `(userId, deviceId)`, giữ status/publicKey
 * hiện tại và `_id` cũ nếu có `bindingId`), rồi mới `$pull` đúng thiết bị đã
 * sao ngược và giảm registeredDevices. Thiết bị sao ngược lỗi thì KHÔNG bị
 * `$pull` (báo trong `errors`). Không xóa smartOTP đã backfill, không xóa
 * collection nguồn. Dry-run mặc định.
 */
export async function rollbackDeviceBindingsEmbed(
  db: DeviceBindingsMigrationDb,
  options: MigrationOptions = {}
): Promise<DeviceBindingsMigrationReport> {
  const dryRun = options.dryRun ?? true
  const report = newReport(
    dryRun,
    `${DEVICE_BINDINGS_EMBED_MIGRATION_ID}:rollback`
  )
  for (const user of await db.readUsersWithDevices()) {
    const userId = user._id.toHexString()
    for (const device of user.smartOTP?.devices ?? []) {
      report.scanned += 1
      report.updated += 1
      if (dryRun) continue
      try {
        await db.upsertBinding({
          _id: device.bindingId ?? new ObjectId(),
          userId,
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          publicKey: device.publicKey,
          status: device.status,
          createdAt: device.createdAt,
          updatedAt: device.updatedAt,
        })
      } catch (error) {
        report.updated -= 1
        report.errors.push(
          `${userId}:${device.deviceId} copy back failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
        continue
      }
      await db.updateUser(
        { _id: user._id, 'smartOTP.devices.deviceId': device.deviceId },
        {
          $pull: { 'smartOTP.devices': { deviceId: device.deviceId } },
          $inc: { 'smartOTP.registeredDevices': -1 },
        }
      )
    }
  }
  return report
}
