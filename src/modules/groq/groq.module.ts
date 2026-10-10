import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { GroqKeyPool } from './groq-key-pool.service'
import { GROQ_KEY_STORE } from './groq-key-store'
import { GroqKeysController } from './groq-keys.controller'
import { GroqKeysService } from './groq-keys.service'
import { GroqApiKey } from './schemas/groq-api-key.schema'

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([GroqApiKey])],
  controllers: [GroqKeysController],
  providers: [
    GroqKeyPool,
    GroqKeysService,
    { provide: GROQ_KEY_STORE, useExisting: GroqKeysService },
  ],
  exports: [GroqKeyPool, GroqKeysService],
})
export class GroqModule {}
