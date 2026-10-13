import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import {
  BiometricEvidenceService,
  IssueBiometricEvidenceInput,
} from './biometric-evidence.service'
import { BiometricEvidence } from '../schemas/biometric-evidence.schema'
import { BadRequestException } from '@nestjs/common'

describe('BiometricEvidenceService', () => {
  let service: BiometricEvidenceService
  let mockRepo: {
    create: jest.Mock
    save: jest.Mock
    findOne: jest.Mock
  }

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn(
        (dto: Partial<BiometricEvidence>) =>
          ({
            ...dto,
            _id: new ObjectId(),
          }) as BiometricEvidence
      ),
      save: jest.fn((dto: BiometricEvidence) => Promise.resolve(dto)),
      findOne: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BiometricEvidenceService,
        {
          provide: getRepositoryToken(BiometricEvidence),
          useValue: mockRepo,
        },
      ],
    }).compile()

    service = module.get<BiometricEvidenceService>(BiometricEvidenceService)
  })

  describe('issueEvidence', () => {
    it('should issue a short-lived token and store its sha256 hash', async () => {
      const input: IssueBiometricEvidenceInput = {
        userId: 'user-tenant-1',
        role: 'tenant',
        contractId: 'contract-123',
        contentLockedHash: 'hash-abc-123',
      }

      const result = await service.issueEvidence(input)

      expect(result.evidenceId).toMatch(/^bio_[a-f0-9]{64}$/)
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now())
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenHash: service.hashToken(result.evidenceId),
          userId: 'user-tenant-1',
          role: 'tenant',
          contractId: 'contract-123',
          contentLockedHash: 'hash-abc-123',
          status: 'verified',
        })
      )
      expect(mockRepo.save).toHaveBeenCalled()
    })

    it('should throw BadRequestException if inputs are missing', async () => {
      await expect(
        service.issueEvidence({
          userId: '',
          role: 'tenant',
          contractId: 'c1',
          contentLockedHash: 'h1',
        })
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('consumeEvidence', () => {
    const validExpected = {
      userId: 'user-tenant-1',
      role: 'tenant' as const,
      contractId: 'contract-123',
      contentLockedHash: 'hash-abc-123',
    }

    it('should successfully consume valid, unexpired evidence', async () => {
      const rawToken =
        'bio_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      const hashed = service.hashToken(rawToken)

      const existingRecord: Partial<BiometricEvidence> = {
        tokenHash: hashed,
        userId: 'user-tenant-1',
        role: 'tenant',
        contractId: 'contract-123',
        contentLockedHash: 'hash-abc-123',
        status: 'verified',
        expiresAt: new Date(Date.now() + 60000),
        consumedAt: null,
      }

      mockRepo.findOne.mockResolvedValue(existingRecord)

      const result = await service.consumeEvidence(rawToken, validExpected)

      expect(result.valid).toBe(true)
      expect(existingRecord.status).toBe('consumed')
      expect(existingRecord.consumedAt).toBeInstanceOf(Date)
      expect(mockRepo.save).toHaveBeenCalledWith(existingRecord)
    })

    it('should reject replay if evidence is already consumed', async () => {
      const rawToken = 'bio_token_replayed'
      mockRepo.findOne.mockResolvedValue({
        tokenHash: service.hashToken(rawToken),
        status: 'consumed',
      })

      const result = await service.consumeEvidence(rawToken, validExpected)

      expect(result.valid).toBe(false)
      expect(result.message).toContain('Replay')
    })

    it('should reject and mark expired if TTL has passed', async () => {
      const rawToken = 'bio_token_expired'
      const expiredRecord = {
        tokenHash: service.hashToken(rawToken),
        status: 'verified',
        expiresAt: new Date(Date.now() - 1000),
      }

      mockRepo.findOne.mockResolvedValue(expiredRecord)

      const result = await service.consumeEvidence(rawToken, validExpected)

      expect(result.valid).toBe(false)
      expect(result.message).toContain('hết hạn')
      expect(expiredRecord.status).toBe('expired')
    })

    it('should reject if userId or role does not match', async () => {
      const rawToken = 'bio_token_wrong_user'
      mockRepo.findOne.mockResolvedValue({
        tokenHash: service.hashToken(rawToken),
        userId: 'different-user',
        role: 'tenant',
        contractId: 'contract-123',
        contentLockedHash: 'hash-abc-123',
        status: 'verified',
        expiresAt: new Date(Date.now() + 60000),
      })

      const result = await service.consumeEvidence(rawToken, validExpected)

      expect(result.valid).toBe(false)
      expect(result.message).toContain('không thuộc về tài khoản này')
    })

    it('should reject if contentLockedHash has changed', async () => {
      const rawToken = 'bio_token_hash_mismatch'
      mockRepo.findOne.mockResolvedValue({
        tokenHash: service.hashToken(rawToken),
        userId: 'user-tenant-1',
        role: 'tenant',
        contractId: 'contract-123',
        contentLockedHash: 'old-hash',
        status: 'verified',
        expiresAt: new Date(Date.now() + 60000),
      })

      const result = await service.consumeEvidence(rawToken, validExpected)

      expect(result.valid).toBe(false)
      expect(result.message).toContain('Nội dung hợp đồng đã thay đổi')
    })
  })
})
