import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Expo } from 'expo-server-sdk'
import { Notification } from './schemas/notification.schema'
import { PushToken } from './schemas/push-token.schema'
import { User } from '../users/schemas/user.schema'
import { NotificationsService } from './services/notifications.service'
import { PushTokensService } from './services/push-tokens.service'
import { EXPO_CLIENT, PushService } from './services/push.service'
import { NotificationsController } from './controllers/notifications.controller'
import { NotificationsGateway } from './gateways/notifications.gateway'
import { NOTIFICATIONS_PUBLISHER } from './gateways/notifications.publisher'

@Module({
  imports: [TypeOrmModule.forFeature([Notification, PushToken, User])],
  providers: [
    NotificationsService,
    PushTokensService,
    PushService,
    { provide: EXPO_CLIENT, useFactory: (): Expo => new Expo() },
    NotificationsGateway,
    { provide: NOTIFICATIONS_PUBLISHER, useExisting: NotificationsGateway },
  ],
  controllers: [NotificationsController],
  exports: [TypeOrmModule, NotificationsService],
})
export class NotificationsModule {}
