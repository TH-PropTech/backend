import { Global, Module } from '@nestjs/common'
import { GroqKeyPool } from './groq-key-pool.service'

@Global()
@Module({
  providers: [GroqKeyPool],
  exports: [GroqKeyPool],
})
export class GroqModule {}
