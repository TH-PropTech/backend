import { Injectable, LoggerService } from '@nestjs/common'
import * as winston from 'winston'
import 'winston-daily-rotate-file'

function safeStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return '[Object]'
    }
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }
  if (typeof value === 'symbol' || typeof value === 'function') {
    return value.toString()
  }
  return ''
}

@Injectable()
export class WinstonLoggerService implements LoggerService {
  private readonly logger: winston.Logger

  constructor() {
    const logFormat = process.env.LOG_FORMAT || 'json'
    const logLevel = process.env.LOG_LEVEL || 'info'
    const logDir = process.env.LOG_DIR || 'logs'

    const formats: winston.Logform.Format[] = [
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
    ]

    const transports: winston.transport[] = []

    // 1. Console Transport (Cho Development / Docker stdout)
    if (logFormat === 'json') {
      formats.push(winston.format.json())
      transports.push(
        new winston.transports.Console({
          level: logLevel,
          format: winston.format.combine(...formats),
        })
      )
    } else {
      // Colorized console format for development
      transports.push(
        new winston.transports.Console({
          level: logLevel,
          format: winston.format.combine(
            winston.format.colorize({ all: true }),
            winston.format.printf(info => {
              const { timestamp, level, message, context, stack, ...meta } =
                info
              const timestampStr =
                typeof timestamp === 'string' ? timestamp : ''
              const levelStr = typeof level === 'string' ? level : ''
              const messageStr = safeStringify(message)

              const ctxStr =
                typeof context === 'string'
                  ? `[${context}] `
                  : context
                    ? `[${safeStringify(context)}] `
                    : ''
              const metaStr = Object.keys(meta).length
                ? `\n${JSON.stringify(meta, null, 2)}`
                : ''
              const stackStr =
                typeof stack === 'string'
                  ? `\n${stack}`
                  : stack
                    ? `\n${safeStringify(stack)}`
                    : ''

              return `${timestampStr} [${levelStr}] ${ctxStr}${messageStr}${metaStr}${stackStr}`
            })
          ),
        })
      )
    }

    // 2. Daily Rotate File Transport (Cho cả local & production để backup)
    transports.push(
      new winston.transports.DailyRotateFile({
        level: logLevel,
        dirname: logDir,
        filename: 'app-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true, // Tự động nén thành file .gz sau khi xoay vòng
        maxSize: '20m', // Max size mỗi file log trước khi tạo file phụ
        maxFiles: '14d', // Giữ log tối đa 14 ngày
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
          winston.format.json() // Log ghi ra file luôn là JSON để chuẩn hóa và dễ parse
        ),
      })
    )

    this.logger = winston.createLogger({
      level: logLevel,
      transports,
    })
  }

  log(message: unknown, context?: string): void {
    if (typeof message === 'object' && message !== null) {
      const msgObj = message as Record<string, unknown>
      const msg = safeStringify(msgObj.message)
      const rest = { ...msgObj }
      delete rest.message
      this.logger.info(msg, { context, ...rest })
    } else {
      this.logger.info(safeStringify(message), { context })
    }
  }

  error(message: unknown, stack?: string, context?: string): void {
    if (typeof message === 'object' && message !== null) {
      const msgObj = message as Record<string, unknown>
      const msg = safeStringify(msgObj.message)
      const rest = { ...msgObj }
      delete rest.message
      this.logger.error(msg, { context, stack, ...rest })
    } else {
      this.logger.error(safeStringify(message), { context, stack })
    }
  }

  warn(message: unknown, context?: string): void {
    if (typeof message === 'object' && message !== null) {
      const msgObj = message as Record<string, unknown>
      const msg = safeStringify(msgObj.message)
      const rest = { ...msgObj }
      delete rest.message
      this.logger.warn(msg, { context, ...rest })
    } else {
      this.logger.warn(safeStringify(message), { context })
    }
  }

  debug(message: unknown, context?: string): void {
    if (typeof message === 'object' && message !== null) {
      const msgObj = message as Record<string, unknown>
      const msg = safeStringify(msgObj.message)
      const rest = { ...msgObj }
      delete rest.message
      this.logger.debug(msg, { context, ...rest })
    } else {
      this.logger.debug(safeStringify(message), { context })
    }
  }

  verbose(message: unknown, context?: string): void {
    if (typeof message === 'object' && message !== null) {
      const msgObj = message as Record<string, unknown>
      const msg = safeStringify(msgObj.message)
      const rest = { ...msgObj }
      delete rest.message
      this.logger.verbose(msg, { context, ...rest })
    } else {
      this.logger.verbose(safeStringify(message), { context })
    }
  }
}
