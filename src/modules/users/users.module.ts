import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { User } from './schemas/user.schema'
import { UsersController } from './controllers/users.controller'
import { KycController } from './controllers/kyc.controller'
import { KycService } from './services/kyc.service'
import { KycMediaService } from './services/kyc-media.service'
import { AuthModule } from '../auth/auth.module'
import { EkycModule } from '../ekyc/ekyc.module'

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule, EkycModule],
  providers: [KycService, KycMediaService],
  controllers: [UsersController, KycController],
  exports: [
    TypeOrmModule,
    // Re-export để mọi nơi trước đây nhận ekyc provider qua UsersModule vẫn nhận được
    EkycModule,
    KycService,
    KycMediaService,
  ],
})
export class UsersModule {}
