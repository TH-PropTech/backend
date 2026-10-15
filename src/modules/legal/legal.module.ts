import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { LegalDocument } from './schemas/legal-document.schema'
import { LegalKnowledgeChunk } from './schemas/legal-knowledge-chunk.schema'
import { Policy } from './schemas/policy.schema'
import { LegalKnowledgeService } from './services/legal-knowledge.service'
import { LegalSourcesService } from './services/legal-sources.service'
import { LegalTermsService } from './services/legal-terms.service'
import { PoliciesService } from './services/policies.service'
import { LegalKnowledgeController } from './controllers/legal-knowledge.controller'
import { LegalSourcesController } from './controllers/legal-sources.controller'
import { LegalTermsController } from './controllers/legal-terms.controller'
import { PoliciesController } from './controllers/policies.controller'
import { LEGAL_KNOWLEDGE_SEARCH } from './utils/legal-knowledge.types'

@Module({
  imports: [
    TypeOrmModule.forFeature([LegalDocument, LegalKnowledgeChunk, Policy]),
  ],
  controllers: [
    LegalKnowledgeController,
    LegalSourcesController,
    LegalTermsController,
    PoliciesController,
  ],
  providers: [
    LegalKnowledgeService,
    { provide: LEGAL_KNOWLEDGE_SEARCH, useExisting: LegalKnowledgeService },
    LegalSourcesService,
    LegalTermsService,
    PoliciesService,
  ],
  exports: [
    LegalKnowledgeService,
    LEGAL_KNOWLEDGE_SEARCH,
    LegalTermsService,
    PoliciesService,
  ],
})
export class LegalModule {}
