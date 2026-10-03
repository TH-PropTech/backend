import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { ContractArtifact } from './schemas/contract-artifact.schema'
import type { Contract } from './schemas/contract.schema'
import { ContractArtifactService } from './contract-artifact.service'
import {
  buildCanonicalContractPayload,
  canonicalizeContractPayload,
  hashCanonicalContractPayload,
} from './legal/contract-canonical-payload'
import { ContractDocumentProjector } from './legal/contract-document.projector'
import { buildReviewedLeaseTemplateSeed } from './legal/lease-template.seed'
import { hashText } from './legal/contract-template.canonical'
import { ContractTemplate } from './legal/contract-template.schema'
import {
  assertSignedContractLedgerEvidence,
  buildSignedContractLedgerEvidence,
  hashSignedContractLedgerEvidence,
} from '../fabric/ledger-evidence-envelope'
import type { ContractArtifactStorage } from './contract-artifact.storage'
import type { ContractArtifact as ContractArtifactRecord } from './schemas/contract-artifact.schema'
import { ContractViewService } from './contract-view.service'
import { ContractsService } from './contracts.service'
import { DepositAgreementsService } from './deposit-agreements.service'
import { DepositConfirmationResolver } from './deposit-confirmation.resolver'
import { SmartCaSigningService } from './smartca/smartca-signing.service'
import { MockBankService } from '../mock-bank/mock-bank.service'

describe('canonical contract workspace integration', () => {
  const contractId = new ObjectId('507f1f77bcf86cd799439011')
  const templateKey = 'VN_INDIVIDUAL_RESIDENTIAL_LEASE'

  function createCanonicalFixture(): {
    contract: Contract
    template: ContractTemplate
  } {
    const seed = buildReviewedLeaseTemplateSeed('PRIVATE_CIVIL_APARTMENT_LEASE')
    const template = Object.assign(new ContractTemplate(), seed, {
      _id: new ObjectId('507f1f77bcf86cd799439012'),
      templateKey,
      version: 3,
      status: 'published' as const,
      reviewStatus: 'published' as const,
      contentHash: hashText('canonical-workspace-template-v3'),
      createdBy: 'legal-reviewer-1',
      publishedBy: 'legal-reviewer-1',
      publishedAt: new Date('2026-09-01T00:00:00.000Z'),
    })
    const contract = {
      _id: contractId,
      contractCode: 'HD-CANONICAL-001',
      propertyId: 'apartment-1',
      propertyTitle: 'Apartment 1',
      propertyAddress: '1 Example Street',
      propertyArea: 68,
      propertyFurniture: 'Fully furnished',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      tenantName: 'Tenant',
      landlordName: 'Landlord',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2027-10-01T00:00:00.000Z'),
      monthlyRent: 18_000_000,
      deposit: 36_000_000,
      paymentDay: 5,
      latePenaltyRate: 8,
      terminationNoticeDays: 30,
      durationMonths: 12,
      commercialDraft: {
        monthlyRent: 18_000_000,
        deposit: 36_000_000,
        paymentDay: 5,
        latePenaltyRate: 8,
        terminationNoticeDays: 30,
        durationMonths: 12,
      },
      contractTemplateRef: {
        key: templateKey,
        version: template.version,
        contentHash: template.contentHash,
        schemaVersion: template.schemaVersion,
        legalProfile: template.legalProfile,
      },
      flowProfileRef: {
        profileId: template.legalProfile,
        version: 1,
        hash: template.contentHash,
      },
      contentLockedHash: null,
      contentLockedAt: null,
      contentRevision: 3,
      hashSchemaVersion: 2,
      artifactRef: null,
    } as unknown as Contract

    return { contract, template }
  }

  it('keeps one canonical payload aligned across Web/Mobile metadata, bytes, verification, and ledger evidence', async () => {
    const { contract, template } = createCanonicalFixture()
    const payload = buildCanonicalContractPayload(contract, template)
    const semanticHash = hashCanonicalContractPayload(payload)
    contract.contentLockedHash = semanticHash
    contract.contentLockedAt = new Date('2026-09-15T08:00:00.000Z')

    const document = ContractDocumentProjector.projectDocument(
      contract,
      template
    )
    expect(document.mode).toBe('locked')
    expect(document.templateVersion).toBe(`${templateKey}@3`)
    expect(document.hashSchemaVersion).toBe(2)
    expect(document.sections).toHaveLength(template.clauses.length)
    expect(document.integrity).toBe('valid')

    const bytes = Buffer.from(
      `%PDF-1.7\n${canonicalizeContractPayload(payload)}`
    )
    const artifactId = new ObjectId('507f1f77bcf86cd799439013')
    const gridFsFileId = new ObjectId('507f1f77bcf86cd799439014')
    let storedBytes = bytes
    let savedArtifact: ContractArtifactRecord | null = null
    const contractRepository = {
      findOne: jest.fn().mockResolvedValue(contract),
      save: jest.fn().mockResolvedValue(contract),
    }
    const artifactRepository = {
      findOne: jest.fn(() => savedArtifact),
      create: jest.fn((input: Partial<ContractArtifactRecord>) =>
        Object.assign(new ContractArtifact(), input, { _id: artifactId })
      ),
      save: jest.fn((value: ContractArtifactRecord) => {
        savedArtifact = value
        return value
      }),
    }
    const storage: ContractArtifactStorage = {
      upload: jest.fn().mockResolvedValue(gridFsFileId),
      download: jest.fn(() => Promise.resolve(storedBytes)),
    }
    const artifactService = new ContractArtifactService(
      contractRepository as never,
      artifactRepository as never,
      storage
    )

    const artifact = await artifactService.lockCanonicalArtifact(
      contractId.toHexString(),
      'admin-1',
      true,
      bytes
    )
    const artifactHash = createHash('sha256').update(bytes).digest('hex')
    expect(artifact.artifactHash).toBe(artifactHash)
    expect(artifact.artifactHash).not.toBe(semanticHash)
    expect(artifact.canonicalContentHash).toBe(semanticHash)
    expect(contract.artifactRef).toEqual(
      expect.objectContaining({
        artifactId: artifactId.toHexString(),
        templateKey,
        templateVersion: 3,
        artifactHash,
        canonicalContentHash: semanticHash,
      })
    )

    const resolved = await artifactService.resolveCanonicalArtifact(contract)
    expect(resolved.bytes).toEqual(bytes)
    expect(resolved.reference.artifactHash).toBe(artifactHash)

    const evidence = buildSignedContractLedgerEvidence({
      contractId: contractId.toHexString(),
      artifact: {
        artifactId: artifactId.toHexString(),
        revision: artifact.revision,
        artifactHash,
        contentType: 'application/pdf',
      },
      signatures: {
        tenant: {
          providerTransactionId: 'sca-tenant-1',
          certificateSerial: 'serial-tenant-1',
          signatureHash: artifactHash,
        },
        landlord: {
          providerTransactionId: 'sca-landlord-1',
          certificateSerial: 'serial-landlord-1',
          signatureHash: artifactHash,
        },
      },
    })
    const ledgerHash = hashSignedContractLedgerEvidence(evidence)
    expect(ledgerHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(evidence)).not.toContain('Tenant')
    expect(JSON.stringify(evidence)).not.toContain('Example Street')
    expect(() =>
      assertSignedContractLedgerEvidence(evidence, {
        artifact: {
          artifactId: artifactId.toHexString(),
          revision: artifact.revision,
          artifactHash,
          contentType: 'application/pdf',
        },
        signatures: {
          tenant: {
            providerTransactionId: 'sca-tenant-1',
            certificateSerial: 'serial-tenant-1',
            signatureHash: artifactHash,
          },
          landlord: {
            providerTransactionId: 'sca-landlord-1',
            certificateSerial: 'serial-landlord-1',
            signatureHash: artifactHash,
          },
        },
      })
    ).not.toThrow()

    storedBytes = Buffer.from('%PDF-1.7\ntampered canonical bytes')
    await expect(
      artifactService.resolveCanonicalArtifact(contract)
    ).rejects.toThrow('CONTRACT_ARTIFACT_HASH_MISMATCH')
  })

  it('accepts every enabled flow action at its endpoint and rejects disabled ones with the same reason', async () => {
    const { contract } = createCanonicalFixture()
    const agreementId = new ObjectId('507f1f77bcf86cd799439015')
    Object.assign(contract, {
      status: 'draft',
      executionMethod: 'SMARTCA',
      executionPolicySnapshot: {
        policyId: 'deposit-first',
        version: 1,
        strategy: 'DEPOSIT_FIRST',
        hash: 'policy-hash',
      },
      depositAgreementId: agreementId.toHexString(),
      depositPaidAt: null,
      signedByTenant: false,
      signedByLandlord: false,
    })
    const agreement = {
      _id: agreementId,
      agreementCode: 'DPA-FLOW-001',
      tenantId: 'tenant-1',
      landlordId: 'landlord-1',
      amount: 36_000_000,
      status: 'draft',
      contentRevision: 1,
      contentHash: 'd'.repeat(64),
      tenantConsent: null,
      paidAt: null,
    }
    const pdfBytes = Buffer.from('%PDF-1.7\nflow-guard-integration')
    const contractRepository = {
      findOne: jest.fn(() => Promise.resolve(contract)),
      save: jest.fn((value: Contract) => Promise.resolve(value)),
    }
    const depositRepository = {
      findOne: jest.fn(() => Promise.resolve(agreement)),
      save: jest.fn((value: typeof agreement) => Promise.resolve(value)),
    }
    let savedArtifact: ContractArtifactRecord | null = null
    const artifactService = new ContractArtifactService(
      contractRepository as never,
      {
        findOne: jest.fn(() => savedArtifact),
        create: jest.fn((input: Partial<ContractArtifactRecord>) =>
          Object.assign(new ContractArtifact(), input, {
            _id: new ObjectId('507f1f77bcf86cd799439016'),
          })
        ),
        save: jest.fn((value: ContractArtifactRecord) => {
          savedArtifact = value
          return value
        }),
      } as never,
      {
        upload: jest
          .fn()
          .mockResolvedValue(new ObjectId('507f1f77bcf86cd799439017')),
        download: jest.fn().mockResolvedValue(pdfBytes),
      }
    )
    const kycService = {
      findByUserId: jest.fn().mockResolvedValue({ status: 'verified' }),
    }
    const viewService = new ContractViewService(
      contractRepository as never,
      depositRepository as never,
      kycService as never,
      { getContractEvents: jest.fn().mockResolvedValue([]) } as never,
      undefined,
      undefined,
      artifactService
    )
    const depositService = new DepositAgreementsService(
      depositRepository as never
    )
    const mockBankService = new MockBankService(
      depositService,
      {} as never,
      {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((value: Record<string, unknown>) => ({
          _id: new ObjectId('507f1f77bcf86cd799439018'),
          ...value,
        })),
        save: jest.fn((value: unknown) => Promise.resolve(value)),
      } as never,
      {} as never,
      {
        isEnabled: jest.fn().mockReturnValue(true),
        get: jest.fn().mockReturnValue({
          name: 'mock-bank',
          newTxRef: jest.fn().mockReturnValue('TX-FLOW-1'),
          createPaymentIntent: jest.fn().mockResolvedValue({
            provider: 'mock-bank',
            txRef: 'TX-FLOW-1',
            expiresAt: new Date(Date.now() + 15 * 60_000),
          }),
        }),
      } as never,
      { get: jest.fn() } as never,
      {} as never,
      contractRepository as never,
      {} as never
    )
    const contractsService = new ContractsService(
      contractRepository as never,
      {} as never,
      depositRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      kycService as never,
      {} as never,
      {} as never
    )
    const smartCaService = new SmartCaSigningService(
      contractRepository as never,
      {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((value: Record<string, unknown>) => ({
          _id: new ObjectId(),
          ...value,
        })),
        save: jest.fn((value: unknown) => Promise.resolve(value)),
      } as never,
      {
        findOne: jest.fn().mockResolvedValue({
          status: 'verified',
          idCardNumber: '000000000001',
        }),
      } as never,
      {
        listCertificates: jest.fn().mockResolvedValue([
          {
            serialNumber: 'serial-tenant-1',
            subject: 'CN=Tenant',
            issuer: 'CN=VNPT SmartCA',
            validFrom: '2026-01-01T00:00:00.000Z',
            validTo: '2027-01-01T00:00:00.000Z',
            isValid: true,
          },
        ]),
        requestSignature: jest.fn(
          ({ transactionId }: { transactionId: string }) =>
            Promise.resolve({
              transactionId,
              transactionCode: 'redacted',
            })
        ),
        getSignatureStatus: jest.fn().mockResolvedValue({
          transactionId: 'provider-transaction',
          status: 'pending',
        }),
      } as never,
      {
        recordSmartCaSignature: jest
          .fn()
          .mockResolvedValue({ status: 'awaiting-signature' }),
      } as never,
      artifactService,
      new DepositConfirmationResolver(depositRepository as never)
    )
    const id = contractId.toHexString()
    const endpoints: Record<string, (actorId: string) => Promise<unknown>> = {
      CONSENT_DEPOSIT: actorId =>
        depositService.consent(
          agreementId.toHexString(),
          actorId,
          agreement.contentRevision,
          agreement.contentHash
        ),
      PAY_DEPOSIT: actorId =>
        mockBankService.initDepositPayment(agreementId.toHexString(), actorId),
      LOCK_CONTENT: actorId =>
        contractsService.lockContractContent(
          id,
          actorId,
          contract.contentRevision ?? 0,
          actorId === 'staff-1'
        ),
      LOCK_ARTIFACT: actorId =>
        artifactService.lockCanonicalArtifact(
          id,
          actorId,
          actorId === 'staff-1',
          pdfBytes
        ),
      SIGN_SMARTCA: actorId =>
        smartCaService.createSession(id, actorId, {
          idempotencyKey: `flow-${actorId}`,
        }),
    }
    const actOnFlow = async (
      actorId: string,
      isStaff: boolean,
      only?: string
    ): Promise<string[]> => {
      const view = await viewService.getForActor(id, actorId, isStaff)
      const performed: string[] = []
      for (const item of view.flow?.nextActions ?? []) {
        const endpoint = endpoints[item.action]
        if (!endpoint || (only && item.action !== only)) continue
        if (item.enabled) {
          await expect(endpoint(actorId)).resolves.toBeDefined()
          performed.push(item.action)
        } else if (item.action === 'PAY_DEPOSIT') {
          await expect(endpoint(actorId)).rejects.toThrow(item.reasonCode ?? '')
        }
      }
      return performed
    }

    await expect(actOnFlow('tenant-1', false, 'PAY_DEPOSIT')).resolves.toEqual(
      []
    )
    await expect(
      actOnFlow('tenant-1', false, 'CONSENT_DEPOSIT')
    ).resolves.toEqual(['CONSENT_DEPOSIT'])
    await expect(actOnFlow('tenant-1', false, 'PAY_DEPOSIT')).resolves.toEqual([
      'PAY_DEPOSIT',
    ])
    Object.assign(agreement, {
      status: 'paid',
      paidAt: new Date('2026-09-20T02:00:00.000Z'),
    })
    await expect(actOnFlow('staff-1', true)).resolves.toEqual(['LOCK_CONTENT'])
    await expect(actOnFlow('landlord-1', false)).resolves.toEqual([
      'LOCK_ARTIFACT',
    ])
    await expect(actOnFlow('tenant-1', false)).resolves.toEqual([
      'SIGN_SMARTCA',
    ])
    expect(
      (await viewService.getForActor(id, 'tenant-1', false)).flow?.activeStage
    ).toBe('signing')
  })

  it('keeps locked history while new template and amendment payloads receive new digests', () => {
    const { contract, template } = createCanonicalFixture()
    const v3Payload = buildCanonicalContractPayload(contract, template)
    const v3Hash = hashCanonicalContractPayload(v3Payload)
    const templateV4 = Object.assign(new ContractTemplate(), template, {
      version: 4,
      contentHash: hashText('canonical-workspace-template-v4'),
      clauses: template.clauses.map(clause =>
        clause.number === 3
          ? {
              ...clause,
              content: `${clause.content} Reviewed release v4.`,
              contentHash: hashText(
                `${clause.heading}\n${clause.content} Reviewed release v4.`
              ),
            }
          : clause
      ),
    })
    const v4Contract = {
      ...contract,
      contractTemplateRef: {
        ...contract.contractTemplateRef!,
        version: 4,
        contentHash: templateV4.contentHash,
      },
    } as Contract
    const v4Payload = buildCanonicalContractPayload(v4Contract, templateV4)
    const amendmentPayload = buildCanonicalContractPayload(
      v4Contract,
      templateV4,
      'amendment-1'
    )

    expect(hashCanonicalContractPayload(v4Payload)).not.toBe(v3Hash)
    expect(hashCanonicalContractPayload(amendmentPayload)).not.toBe(
      hashCanonicalContractPayload(v4Payload)
    )
    expect(
      ContractDocumentProjector.projectDocument(v4Contract, templateV4)
        .templateVersion
    ).toBe(`${templateKey}@4`)
    expect(v3Payload.amendmentId).toBeNull()
    expect(amendmentPayload.amendmentId).toBe('amendment-1')
  })
})
