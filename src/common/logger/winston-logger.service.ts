import { Injectable, LoggerService } from '@nestjs/common';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import * as path from 'path';

@Injectable()
export class WinstonLoggerService implements LoggerService {
  private readonly logger: winston.Logger;

  constructor() {
    const logFormat = process.env.LOG_FORMAT || 'json';
    const logLevel = process.env.LOG_LEVEL || 'info';
    const logDir = process.env.LOG_DIR || 'logs';

    const formats: winston.Logform.Format[] = [
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
    ];

    const transports: winston.transport[] = [];

    // 1. Console Transport (Cho Development / Docker stdout)
    if (logFormat === 'json') {
      formats.push(winston.format.json());
      transports.push(
        new winston.transports.Console({
          level: logLevel,
          format: winston.format.combine(...formats),
        }),
      );
    } else {
      // Colorized console format for development
      transports.push(
        new winston.transports.Console({
          level: logLevel,
          format: winston.format.combine(
            winston.format.colorize({ all: true }),
            winston.format.printf((info) => {
              const { timestamp, level, message, context, stack, ...meta } = info;
              const ctxStr = context ? `[${context}] ` : '';
              const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
              const stackStr = stack ? `\n${stack}` : '';
              return `${timestamp} [${level}] ${ctxStr}${message}${metaStr}${stackStr}`;
            }),
          ),
        }),
      );
    }

    // 2. Daily Rotate File Transport (Cho cả local & production để backup)
    transports.push(
      new winston.transports.DailyRotateFile({
        level: logLevel,
        dirname: logDir,
        filename: 'app-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true, // Tự động nén thành file .gz sau khi xoay vòng
        maxSize: '20m',      // Max size mỗi file log trước khi tạo file phụ (ví dụ: app-2026-06-02.log.1)
        maxFiles: '14d',     // Giữ log tối đa 14 ngày (sẽ tự động xóa log cũ hơn)
        format: winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
          winston.format.json(), // Log ghi ra file luôn là JSON để chuẩn hóa và dễ parse
        ),
      }),
    );

    this.logger = winston.createLogger({
      level: logLevel,
      transports,
    });
  }

  log(message: any, context?: string) {
    if (typeof message === 'object') {
      const { message: msg, ...meta } = message;
      this.logger.info(msg, { context, ...meta });
    } else {
      this.logger.info(message, { context });
    }
  }

  error(message: any, stack?: string, context?: string) {
    if (typeof message === 'object') {
      const { message: msg, ...meta } = message;
      this.logger.error(msg, { context, stack, ...meta });
    } else {
      this.logger.error(message, { context, stack });
    }
  }

  warn(message: any, context?: string) {
    if (typeof message === 'object') {
      const { message: msg, ...meta } = message;
      this.logger.warn(msg, { context, ...meta });
    } else {
      this.logger.warn(message, { context });
    }
  }

  debug(message: any, context?: string) {
    if (typeof message === 'object') {
      const { message: msg, ...meta } = message;
      this.logger.debug(msg, { context, ...meta });
    } else {
      this.logger.debug(message, { context });
    }
  }

  verbose(message: any, context?: string) {
    if (typeof message === 'object') {
      const { message: msg, ...meta } = message;
      this.logger.verbose(msg, { context, ...meta });
    } else {
      this.logger.verbose(message, { context });
    }
  }
}