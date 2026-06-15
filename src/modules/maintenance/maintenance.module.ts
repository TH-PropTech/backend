import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { MaintenanceTicket } from './schemas/maintenance-ticket.schema'

@Module({
  imports: [TypeOrmModule.forFeature([MaintenanceTicket])],
  exports: [TypeOrmModule],
})
export class MaintenanceModule {}
