import 'reflect-metadata'
import { ObjectId } from 'mongodb'
import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import { ContractDocumentProjector } from './contract-document.projector'
import { hashText } from './contract-template.canonical'
import { ContractTemplateGovernanceService } from './contract-template-governance.service'
import {
  ContractTemplate,
  type ContractTemplateClause,
} from '../schemas/contract-template.schema'
import { ContractTemplatesController } from './contract-templates.controller'
import { buildReviewedLeaseTemplateSeed } from './lease-template.seed'
import { resolveLegalProfile } from './legal-profile.resolver'
import type { Contract } from '../schemas/contract.schema'
import { ConfigAuditService } from '../../activity-log/services/config-audit.service'
import { ConfigAudit } from '../../activity-log/schemas/config-audit.schema'

function getMethodTarget(prototype: object, methodName: string): object {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName)
  if (!descriptor || typeof descriptor.value !== 'function') {
    throw new Error(`Missing method descriptor: ${methodName}`)
  }
  const method: unknown = descriptor.value
  if (typeof method !== 'function') {
    throw new Error(`Invalid method descriptor: ${methodName}`)
  }
  return method
}

describe('contract template governance integration', () => {
  const templateKey = 'VN_INDIVIDUAL_RESIDENTIAL_LEASE'

  function setup(): {
    service: ContractTemplateGovernanceService
    templates: Map<string, ContractTemplate[]>
    audits: ConfigAudit[]
  } {
    const templates = new Map<string, ContractTemplate[]>()
    const audits: ConfigAudit[] = []
    const templateRepository = {
      findOne: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const rows = (templates.get(String(where.templateKey)) ?? [])
          .filter(template =>
            typeof where.status === 'string'
              ? template.status === where.status
              : true
          )
          .filter(template =>
            typeof where.version === 'number'
              ? template.version === where.version
              : true
          )
          .sort((left, right) => right.version - left.version)
        return rows[0] ?? null
      }),
      create: jest.fn((value: Partial<ContractTemplate>) =>
        Object.assign(new ContractTemplate(), value, { _id: new ObjectId() })
      ),
      save: jest.fn((value: ContractTemplate) => {
        const rows = templates.get(value.templateKey) ?? []
        const index = rows.findIndex(row => row.version === value.version)
        if (index >= 0) rows[index] = value
        else rows.push(value)
        templates.set(value.templateKey, rows)
        return value
      }),
    }
    const auditRepository = {
      create: jest.fn((value: Partial<ConfigAudit>) =>
        Object.assign(new ConfigAudit(), value)
      ),
      save: jest.fn((value: ConfigAudit) => {
        audits.push(value)
        return value
      }),
      find: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          audits.filter(
            audit =>
              audit.scope === where.scope &&
              audit.key === where.key &&
              (typeof where.version !== 'number' ||
                audit.version === where.version)
          )
        )
      ),
    }

    return {
      service: new ContractTemplateGovernanceService(
        templateRepository as never,
        new ConfigAuditService(auditRepository as never)
      ),
      templates,
      audits,
    }
  }

  function changedClauses(
    seedClauses: ContractTemplateClause[]
  ): ContractTemplateClause[] {
    return seedClauses.map(clause => {
      if (clause.number !== 3) return clause
      const content = `${clause.content} Reviewed release v2.`
      return {
        ...clause,
        content,
        contentHash: hashText(`${clause.heading}\n${content}`),
      }
    })
  }

  it('keeps the contract snapshot on v1 while new drafts resolve the reviewed v2 release', async () => {
    const { service, templates, audits } = setup()
    await service.seedReviewedTemplatesIfMissing()

    const versionOne = await service.getPublishedVersion(templateKey, 1)
    const contract = {
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      contractCode: 'HD-LEGAL-INTEGRATION-1',
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
      contentLockedHash: null,
      contentLockedAt: null,
      contractTemplateRef: {
        key: templateKey,
        version: versionOne.version,
        contentHash: versionOne.contentHash,
        schemaVersion: versionOne.schemaVersion,
        legalProfile: versionOne.legalProfile,
      },
    } as unknown as Contract

    const snapshotV1 = ContractDocumentProjector.projectDocument(
      contract,
      versionOne
    )
    expect(snapshotV1.templateVersion).toBe(`${templateKey}@1`)
    expect(snapshotV1.sections[2]?.content).toContain('18.000.000')

    const seed = buildReviewedLeaseTemplateSeed('PRIVATE_CIVIL_APARTMENT_LEASE')
    const versionTwo = await service.publishLegalRelease(
      templateKey,
      {
        ...seed,
        clauses: changedClauses(seed.clauses),
        reviewReference: 'PROP-321-LEGAL-REVIEW-2026-10',
      },
      'legal-reviewer-1',
      'approved v2 legal release'
    )

    expect(versionTwo.version).toBe(2)
    await expect(service.getPublishedVersion(templateKey, 1)).resolves.toBe(
      versionOne
    )
    await expect(service.getPublishedVersion(templateKey)).resolves.toBe(
      versionTwo
    )

    const newDraftSnapshot = ContractDocumentProjector.projectDocument(
      {
        ...contract,
        contractTemplateRef: {
          ...contract.contractTemplateRef!,
          version: versionTwo.version,
          contentHash: versionTwo.contentHash,
        },
      },
      versionTwo
    )
    expect(newDraftSnapshot.templateVersion).toBe(`${templateKey}@2`)
    expect(newDraftSnapshot.sections[2]?.content).toContain(
      'Reviewed release v2'
    )
    expect(snapshotV1.sections[2]?.content).not.toContain('Reviewed release v2')
    expect(templates.get(templateKey)).toHaveLength(2)
    expect(
      audits.filter(audit => audit.action === 'legal-release-published')
    ).toHaveLength(3)
  })

  it('fails closed for ambiguous legal context and keeps template mutation Admin-only', () => {
    expect(() =>
      resolveLegalProfile({
        landlordType: 'business',
        operatesRealEstateBusiness: false,
        verified: true,
      })
    ).toThrow('LEGAL_PROFILE_UNRESOLVED')

    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        getMethodTarget(ContractTemplatesController.prototype, 'saveDraft')
      )
    ).toEqual(['admin'])
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        getMethodTarget(
          ContractTemplatesController.prototype,
          'publishLegalRelease'
        )
      )
    ).toEqual(['admin'])
  })
})
