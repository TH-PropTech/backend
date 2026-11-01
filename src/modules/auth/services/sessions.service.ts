import { Injectable, UnauthorizedException, Optional } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ConfigService } from '@nestjs/config'
import { ObjectId } from 'mongodb'
import * as crypto from 'crypto'
import { AuthSession } from '../schemas/auth-session.schema'

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function parseDeviceLabel(userAgent?: string): string {
  if (!userAgent || typeof userAgent !== 'string' || !userAgent.trim()) {
    return 'Thiết bị không xác định'
  }

  const ua = userAgent.trim()

  // Detect Mobile Native / HTTP clients
  if (/okhttp|Retrofit|CFNetwork|Darwin|vn\.thproptech\.mobile/i.test(ua)) {
    if (/Android|Linux/i.test(ua) || /okhttp/i.test(ua)) {
      return 'Ứng dụng di động Android'
    }
    if (/iPhone|iPad|iPod|iOS|CFNetwork|Darwin/i.test(ua)) {
      return 'Ứng dụng di động iOS'
    }
    return 'Ứng dụng di động'
  }

  // Detect OS
  let os = 'Thiết bị khác'
  if (/Windows NT/i.test(ua)) {
    os = 'Windows'
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    os = 'iOS'
  } else if (/Android/i.test(ua)) {
    os = 'Android'
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = 'macOS'
  } else if (/Linux/i.test(ua)) {
    os = 'Linux'
  }

  // Detect Browser
  let browser = 'Trình duyệt'
  if (/Edg\//i.test(ua)) {
    browser = 'Edge'
  } else if (/OPR\/|Opera/i.test(ua)) {
    browser = 'Opera'
  } else if (/Chrome\/|CriOS\//i.test(ua)) {
    browser = 'Chrome'
  } else if (/Firefox\/|FxiOS\//i.test(ua)) {
    browser = 'Firefox'
  } else if (/Safari/i.test(ua) && !/Chrome|CriOS|Android/i.test(ua)) {
    browser = 'Safari'
  } else if (/PostmanRuntime/i.test(ua)) {
    browser = 'Postman'
  } else if (/MobileApp|Dart|Expo|Flutter/i.test(ua)) {
    return os !== 'Thiết bị khác' ? `Ứng dụng trên ${os}` : 'Ứng dụng di động'
  }

  if (os === 'Android' && browser === 'Trình duyệt') {
    return 'Ứng dụng di động Android'
  }
  if (os === 'iOS' && browser === 'Trình duyệt') {
    return 'Ứng dụng di động iOS'
  }

  if (os === 'Thiết bị khác' && browser === 'Trình duyệt') {
    return 'Thiết bị không xác định'
  }

  if (os === 'Thiết bị khác') {
    return browser
  }

  return `${browser} trên ${os}`
}

export function maskIp(ip?: string): string {
  if (!ip || typeof ip !== 'string' || !ip.trim()) {
    return '***'
  }
  let cleanIp = ip.trim()

  // Handle IPv6-mapped IPv4 e.g. "::ffff:192.168.1.15"
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.slice(7)
  }

  // Localhost addresses
  if (cleanIp === '::1' || cleanIp === '127.0.0.1' || cleanIp === 'localhost') {
    return '127.0.0.*'
  }

  const ipv4Parts = cleanIp.split('.')
  if (ipv4Parts.length === 4) {
    return `${ipv4Parts[0]}.${ipv4Parts[1]}.${ipv4Parts[2]}.*`
  }

  if (cleanIp.includes(':')) {
    if (cleanIp === '::') {
      return 'Mạng cục bộ'
    }
    const parts = cleanIp.split(':')
    if (parts.length > 1) {
      parts[parts.length - 1] = '*'
      const masked = parts.join(':')
      return masked === '::*' ? 'Mạng cục bộ' : masked
    }
  }

  return cleanIp
}

export interface CreateSessionOptions {
  userId: ObjectId | string
  refreshToken: string
  userAgent?: string | undefined
  ip?: string | undefined
  customSessionId?: ObjectId | undefined
}

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(AuthSession)
    private readonly sessionRepository: Repository<AuthSession>,
    @Optional()
    private readonly configService?: ConfigService
  ) {}

  isEnforceEnabled(): boolean {
    if (!this.configService) return true
    const enforce = this.configService.get<string | boolean>(
      'AUTH_SESSION_ENFORCE'
    )
    if (enforce === false || enforce === 'false' || enforce === '0') {
      return false
    }
    return true
  }

  async createSession(options: CreateSessionOptions): Promise<AuthSession> {
    const rawUserId = options.userId
    const userId =
      rawUserId instanceof ObjectId ? rawUserId : new ObjectId(rawUserId)

    const userAgent = options.userAgent || ''
    const ip = options.ip || '127.0.0.1'
    const deviceLabel = parseDeviceLabel(userAgent)
    const refreshTokenHash = hashRefreshToken(options.refreshToken)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const session = this.sessionRepository.create({
      ...(options.customSessionId ? { _id: options.customSessionId } : {}),
      userId,
      refreshTokenHash,
      userAgent,
      deviceLabel,
      ip,
      lastActiveAt: now,
      createdAt: now,
      revokedAt: null,
      expiresAt,
    })

    return this.sessionRepository.save(session)
  }

  async findByTokenHash(refreshTokenHash: string): Promise<AuthSession | null> {
    return this.sessionRepository.findOne({
      where: { refreshTokenHash },
    })
  }

  async rotateSession(
    oldRefreshToken: string,
    newRefreshToken: string,
    context?: { ip?: string; userAgent?: string }
  ): Promise<AuthSession | null> {
    const oldHash = hashRefreshToken(oldRefreshToken)
    const session = await this.findByTokenHash(oldHash)

    if (!session) {
      return null
    }

    if (session.revokedAt != null) {
      if (this.isEnforceEnabled()) {
        throw new UnauthorizedException('Phiên đăng nhập đã bị thu hồi')
      }
    }

    const now = new Date()
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    session.refreshTokenHash = hashRefreshToken(newRefreshToken)
    session.lastActiveAt = now
    session.expiresAt = expiresAt

    if (context?.ip) {
      session.ip = context.ip
    }
    if (context?.userAgent !== undefined) {
      session.userAgent = context.userAgent
      session.deviceLabel = parseDeviceLabel(context.userAgent)
    }

    return this.sessionRepository.save(session)
  }

  async findActiveSessionsByUserId(
    userId: string | ObjectId
  ): Promise<AuthSession[]> {
    const targetUserId =
      userId instanceof ObjectId ? userId : new ObjectId(userId)

    const sessions = await this.sessionRepository.find({
      where: {
        userId: targetUserId,
      },
      order: {
        lastActiveAt: 'DESC',
      },
    })

    return sessions.filter(s => !s.revokedAt)
  }

  async revokeSession(
    userId: string | ObjectId,
    sessionId: string | ObjectId
  ): Promise<boolean> {
    let targetSessionId: ObjectId
    let targetUserId: ObjectId
    try {
      targetSessionId =
        sessionId instanceof ObjectId ? sessionId : new ObjectId(sessionId)
      targetUserId = userId instanceof ObjectId ? userId : new ObjectId(userId)
    } catch {
      return false
    }

    const session = await this.sessionRepository.findOne({
      where: {
        _id: targetSessionId,
        userId: targetUserId,
      },
    })

    if (!session) {
      return false
    }

    session.revokedAt = new Date()
    await this.sessionRepository.save(session)
    return true
  }
}
