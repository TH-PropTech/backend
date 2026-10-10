import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { LegalKnowledgeController } from './legal-knowledge.controller'
import { LegalKnowledgeService } from './legal-knowledge.service'
import { LEGAL_KNOWLEDGE_SEARCH } from './legal-knowledge.types'
import { LegalKnowledgeChunk } from './schemas/legal-knowledge-chunk.schema'
import { LegalKnowledgeDoc } from './schemas/legal-knowledge-doc.schema'

@Module({
  imports: [TypeOrmModule.forFeature([LegalKnowledgeDoc, LegalKnowledgeChunk])],
  controllers: [LegalKnowledgeController],
  providers: [
    LegalKnowledgeService,
    { provide: LEGAL_KNOWLEDGE_SEARCH, useExisting: LegalKnowledgeService },
  ],
  exports: [LegalKnowledgeService, LEGAL_KNOWLEDGE_SEARCH],
})
export class LegalKnowledgeModule {}
