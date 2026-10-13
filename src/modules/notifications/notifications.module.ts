import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Notification } from './schemas/notification.schema'
import { NotificationsService } from './services/notifications.service'
import { NotificationsController } from './controllers/notifications.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Notification])],
  providers: [NotificationsService],
  controllers: [NotificationsController],
  exports: [TypeOrmModule, NotificationsService],
})
export class NotificationsModule {}
