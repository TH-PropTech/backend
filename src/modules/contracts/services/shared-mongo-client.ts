import type { MongoClient } from 'mongodb'
import type { DataSource } from 'typeorm'

/**
 * Lấy `MongoClient` mà TypeORM đang giữ (một connection pool duy nhất cho toàn backend).
 * Phải gọi tại thời điểm dùng, không gọi trong constructor: client chỉ có sau `DataSource.initialize()`.
 * Không được `close()` client này; TypeORM đóng khi shutdown.
 */
export function getSharedMongoClient(dataSource: DataSource): MongoClient {
  // Kiểu khai báo là non-optional nhưng runtime là undefined trước initialize / sau disconnect.
  const queryRunner = dataSource.mongoManager.mongoQueryRunner as
    | { databaseConnection: unknown }
    | undefined
  if (!queryRunner) throw new Error('MongoDB client chưa sẵn sàng')
  // TypeORM dùng bản typings `mongodb` đóng gói riêng; runtime cùng là MongoClient của peer `mongodb`.
  return queryRunner.databaseConnection as MongoClient
}
