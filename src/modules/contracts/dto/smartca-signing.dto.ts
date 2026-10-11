import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import type { SmartCaCertificate } from '../smartca/smartca.provider'
import type { SmartCaSigningSession } from '../smartca/smartca-signing-session.schema'

export class CreateSmartCaSigningSessionDto {
  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string

  @ApiPropertyOptional({ maxLength: 256 })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  certificateSerial?: string
}

export class SignSmartCaV2Dto extends CreateSmartCaSigningSessionDto {
  @ApiProperty({ writeOnly: true, maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  smartCaPassword!: string

  @ApiProperty({ writeOnly: true, maxLength: 16 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  smartCaOtp!: string
}

export class SigningMethodOptionDto {
  @ApiProperty({
    enum: ['smartca_v1', 'smartca_v2', 'biometric_smart_otp', 'dev_sign'],
  })
  id!: string

  @ApiProperty()
  label!: string

  @ApiProperty()
  description!: string

  @ApiProperty()
  available!: boolean

  @ApiPropertyOptional()
  reason?: string

  @ApiProperty({ type: [String] })
  inputs!: string[]
}

export class SmartCaCertificateDto {
  @ApiProperty()
  serialNumber!: string

  @ApiPropertyOptional()
  subject?: string

  @ApiPropertyOptional()
  issuer?: string

  @ApiPropertyOptional({ format: 'date-time' })
  validFrom?: string

  @ApiPropertyOptional({ format: 'date-time' })
  validTo?: string
}

export class SmartCaCertificateListDto {
  @ApiProperty({ type: [SmartCaCertificateDto] })
  certificates!: SmartCaCertificateDto[]
}

export class SmartCaSigningSessionDto {
  @ApiProperty()
  id!: string

  @ApiProperty()
  contractId!: string

  @ApiProperty()
  signerId!: string

  @ApiProperty({ enum: ['tenant', 'landlord'] })
  signerRole!: 'tenant' | 'landlord'

  @ApiProperty()
  artifactHash!: string

  @ApiProperty()
  providerTransactionId!: string

  @ApiProperty({
    enum: ['pending', 'signed', 'rejected', 'expired', 'cancelled'],
  })
  status!: 'pending' | 'signed' | 'rejected' | 'expired' | 'cancelled'

  @ApiPropertyOptional()
  idempotencyKey?: string | null

  @ApiPropertyOptional()
  confirmationUrl?: string | null

  @ApiPropertyOptional()
  certificateSerial?: string | null

  @ApiPropertyOptional()
  certificateSubject?: string | null

  @ApiPropertyOptional()
  certificateIssuer?: string | null

  @ApiPropertyOptional()
  signatureHash?: string | null

  @ApiPropertyOptional()
  signatureAlgorithm?: string | null

  @ApiPropertyOptional()
  providerStatus?: string | null

  @ApiPropertyOptional()
  documentId?: string | null

  @ApiPropertyOptional({ format: 'date-time' })
  signedAt?: string | null

  @ApiPropertyOptional({ format: 'date-time' })
  verifiedAt?: string | null

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string

  @ApiPropertyOptional({ format: 'date-time' })
  createdAt?: string

  @ApiPropertyOptional({ format: 'date-time' })
  updatedAt?: string
}

export function toSmartCaCertificateListDto(
  certificates: SmartCaCertificate[]
): SmartCaCertificateListDto {
  return {
    certificates: certificates.map(certificate => ({
      serialNumber: certificate.serialNumber,
      ...(certificate.subject ? { subject: certificate.subject } : {}),
      ...(certificate.issuer ? { issuer: certificate.issuer } : {}),
      ...(certificate.validFrom ? { validFrom: certificate.validFrom } : {}),
      ...(certificate.validTo ? { validTo: certificate.validTo } : {}),
    })),
  }
}

export function toSmartCaSigningSessionDto(
  session: SmartCaSigningSession
): SmartCaSigningSessionDto {
  return {
    id: session._id.toHexString(),
    contractId: session.contractId,
    signerId: session.signerId,
    signerRole: session.signerRole,
    artifactHash: session.artifactHash,
    providerTransactionId: session.providerTransactionId,
    status: session.status,
    idempotencyKey: session.idempotencyKey ?? null,
    confirmationUrl: session.confirmationUrl ?? null,
    certificateSerial: session.certificateSerial ?? null,
    certificateSubject: session.certificateSubject ?? null,
    certificateIssuer: session.certificateIssuer ?? null,
    signatureHash: session.signatureHash ?? null,
    signatureAlgorithm: session.signatureAlgorithm ?? null,
    providerStatus: session.providerStatus ?? null,
    documentId: session.documentId ?? null,
    signedAt: session.signedAt?.toISOString() ?? null,
    verifiedAt: session.verifiedAt?.toISOString() ?? null,
    expiresAt: session.expiresAt.toISOString(),
    ...(session.createdAt
      ? { createdAt: session.createdAt.toISOString() }
      : {}),
    ...(session.updatedAt
      ? { updatedAt: session.updatedAt.toISOString() }
      : {}),
  }
}
