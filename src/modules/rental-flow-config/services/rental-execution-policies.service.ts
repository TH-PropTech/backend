import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { RentalFlowAudit } from '../schemas/rental-flow-audit.schema'
import { RentalExecutionPolicy } from '../schemas/rental-execution-policy.schema'
import {
  computeRentalExecutionPolicyHash,
  DEFAULT_RENTAL_EXECUTION_POLICY_INPUTS,
  getDefaultRentalExecutionPolicyRef,
  isRentalExecutionStrategy,
  type RentalExecutionPolicyRef,
} from '../utils/rental-execution-policy.util'
import type { SaveRentalExecutionPolicyDraftDto } from '../dto/save-rental-execution-policy-draft.dto'
import type { PublishRentalExecutionPolicyDto } from '../dto/publish-rental-execution-policy.dto'

@Injectable()
export class RentalExecutionPoliciesService implements OnModuleInit {
  constructor(
    @InjectRepository(RentalExecutionPolicy)
    private readonly policyRepo: Repository<RentalExecutionPolicy>,
    @InjectRepository(RentalFlowAudit)
    private readonly auditRepo: Repository<RentalFlowAudit>
  ) {}

  async onModuleInit(): Promise<void> {
    for (const input of DEFAULT_RENTAL_EXECUTION_POLICY_INPUTS) {
      const existing = await this.policyRepo.findOne({
        where: { policyId: input.policyId, status: 'published', version: 1 },
      })
      if (existing) continue
      const contentHash = computeRentalExecutionPolicyHash({
        ...input,
        version: 1,
      })
      await this.policyRepo.save(
        this.policyRepo.create({
          policyId: input.policyId,
          version: 1,
          status: 'published',
          strategy: input.strategy,
          name: input.name,
          description: input.description,
          disclosure: input.disclosure,
          contentHash,
          draftRevision: 1,
          createdBy: 'system',
          publishedBy: 'system',
          publishedAt: new Date(),
        })
      )
    }
  }

  async listActive(): Promise<RentalExecutionPolicy[]> {
    return this.policyRepo.find({
      where: { status: 'published' },
      order: { policyId: 'ASC', version: 'DESC' },
    })
  }

  async listAll(): Promise<RentalExecutionPolicy[]> {
    return this.policyRepo.find({ order: { createdAt: 'DESC' } })
  }

  async saveDraft(
    policyId: string,
    dto: SaveRentalExecutionPolicyDraftDto,
    actorId: string
  ): Promise<RentalExecutionPolicy> {
    if (!isRentalExecutionStrategy(dto.strategy)) {
      throw new ConflictException('UNSUPPORTED_RENTAL_EXECUTION_STRATEGY')
    }
    let draft = await this.policyRepo.findOne({
      where: { policyId, status: 'draft' },
    })
    if (draft) {
      if (draft.draftRevision !== dto.expectedRevision) {
        throw new ConflictException('RENTAL_EXECUTION_POLICY_REVISION_STALE')
      }
      draft.strategy = dto.strategy
      draft.name = dto.name
      draft.description = dto.description
      draft.disclosure = dto.disclosure
      draft.draftRevision += 1
      draft.updatedBy = actorId
    } else {
      draft = this.policyRepo.create({
        policyId,
        version: null,
        status: 'draft',
        strategy: dto.strategy,
        name: dto.name,
        description: dto.description,
        disclosure: dto.disclosure,
        contentHash: null,
        draftRevision: 1,
        createdBy: actorId,
        updatedBy: actorId,
      })
    }
    const saved = await this.policyRepo.save(draft)
    await this.auditRepo.save(
      this.auditRepo.create({
        action: 'EXECUTION_POLICY_DRAFT_SAVED',
        actorId,
        targetType: 'execution-policy',
        targetId: policyId,
        version: null,
        details: { draftRevision: saved.draftRevision },
      })
    )
    return saved
  }

  async publish(
    policyId: string,
    dto: PublishRentalExecutionPolicyDto,
    actorId: string
  ): Promise<RentalExecutionPolicy> {
    const draft = await this.policyRepo.findOne({
      where: { policyId, status: 'draft' },
    })
    if (!draft) throw new NotFoundException('RENTAL_EXECUTION_POLICY_NOT_FOUND')
    if (draft.draftRevision !== dto.expectedRevision) {
      throw new ConflictException('RENTAL_EXECUTION_POLICY_REVISION_STALE')
    }
    const latest = await this.policyRepo.findOne({
      where: { policyId, status: 'published' },
      order: { version: 'DESC' },
    })
    const version = (latest?.version ?? 0) + 1
    const contentHash = computeRentalExecutionPolicyHash({
      policyId,
      version,
      strategy: draft.strategy,
      name: draft.name,
      description: draft.description,
      disclosure: draft.disclosure,
    })
    const published = await this.policyRepo.save(
      this.policyRepo.create({
        policyId,
        version,
        status: 'published',
        strategy: draft.strategy,
        name: draft.name,
        description: draft.description,
        disclosure: draft.disclosure,
        contentHash,
        draftRevision: draft.draftRevision,
        createdBy: draft.createdBy ?? actorId,
        publishedBy: actorId,
        publishedAt: new Date(),
      })
    )
    draft.draftRevision += 1
    draft.updatedBy = actorId
    await this.policyRepo.save(draft)
    await this.auditRepo.save(
      this.auditRepo.create({
        action: 'EXECUTION_POLICY_PUBLISHED',
        actorId,
        targetType: 'execution-policy',
        targetId: policyId,
        version,
        details: { reason: dto.reason, contentHash },
      })
    )
    return published
  }

  async archive(
    policyId: string,
    version: number,
    actorId: string,
    reason: string
  ): Promise<RentalExecutionPolicy> {
    const policy = await this.policyRepo.findOne({
      where: { policyId, status: 'published', version },
    })
    if (!policy)
      throw new NotFoundException('RENTAL_EXECUTION_POLICY_NOT_FOUND')
    policy.status = 'archived'
    policy.archivedAt = new Date()
    const saved = await this.policyRepo.save(policy)
    await this.auditRepo.save(
      this.auditRepo.create({
        action: 'EXECUTION_POLICY_ARCHIVED',
        actorId,
        targetType: 'execution-policy',
        targetId: policyId,
        version,
        details: { reason },
      })
    )
    return saved
  }

  async resolvePublishedRef(
    ref: RentalExecutionPolicyRef
  ): Promise<RentalExecutionPolicy> {
    if (!isRentalExecutionStrategy(ref.strategy)) {
      throw new ConflictException('UNSUPPORTED_RENTAL_EXECUTION_STRATEGY')
    }
    const policy = await this.policyRepo.findOne({
      where: {
        policyId: ref.policyId,
        status: 'published',
        version: ref.version,
      },
    })
    if (
      !policy ||
      policy.strategy !== ref.strategy ||
      policy.contentHash !== ref.contentHash
    ) {
      throw new ConflictException('RENTAL_EXECUTION_POLICY_INVALID')
    }
    return policy
  }

  async validatePackagePolicies(
    refs: readonly RentalExecutionPolicyRef[] | undefined,
    defaultRef: RentalExecutionPolicyRef | undefined
  ): Promise<{
    allowedExecutionPolicies: RentalExecutionPolicyRef[]
    defaultExecutionPolicy: RentalExecutionPolicyRef
  }> {
    const normalizedRefs =
      refs && refs.length > 0
        ? [...refs]
        : [getDefaultRentalExecutionPolicyRef()]
    const resolved = await Promise.all(
      normalizedRefs.map(ref => this.resolvePublishedRef(ref))
    )
    const uniqueStrategies = new Set(resolved.map(policy => policy.strategy))
    if (uniqueStrategies.size !== resolved.length) {
      throw new ConflictException('RENTAL_EXECUTION_POLICY_INVALID')
    }
    const firstPolicy = resolved[0]
    if (!firstPolicy) {
      throw new ConflictException('RENTAL_EXECUTION_POLICY_INVALID')
    }
    const normalizedDefault = defaultRef ?? this.toRef(firstPolicy)
    await this.resolvePublishedRef(normalizedDefault)
    if (
      !normalizedRefs.some(
        ref =>
          ref.policyId === normalizedDefault.policyId &&
          ref.version === normalizedDefault.version
      )
    ) {
      throw new ConflictException('RENTAL_EXECUTION_POLICY_INVALID')
    }
    return {
      allowedExecutionPolicies: resolved.map(policy => this.toRef(policy)),
      defaultExecutionPolicy: normalizedDefault,
    }
  }

  private toRef(policy: RentalExecutionPolicy): RentalExecutionPolicyRef {
    if (policy.version === null || policy.contentHash === null) {
      throw new ConflictException('RENTAL_EXECUTION_POLICY_INVALID')
    }
    return {
      policyId: policy.policyId,
      version: policy.version,
      strategy: policy.strategy,
      contentHash: policy.contentHash,
    }
  }
}
