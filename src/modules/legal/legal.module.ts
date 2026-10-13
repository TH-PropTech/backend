import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { LegalKnowledgeDoc } from './schemas/legal-knowledge-doc.schema'
import { LegalKnowledgeChunk } from './schemas/legal-knowledge-chunk.schema'
import { LegalSource } from './schemas/legal-source.schema'
import { PlatformRegulation } from './schemas/platform-regulation.schema'
import { LegalTermsDocument } from './schemas/legal-terms-document.schema'
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
    TypeOrmModule.forFeature([
      LegalKnowledgeDoc,
      LegalKnowledgeChunk,
      LegalSource,
      PlatformRegulation,
      LegalTermsDocument,
      Policy,
    ]),
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
