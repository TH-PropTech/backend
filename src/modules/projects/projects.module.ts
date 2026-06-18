import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Project } from './schemas/project.schema'
import { Apartment } from '../apartments/schemas/apartment.schema'
import { ProjectsService } from './projects.service'
import { ProjectsController } from './projects.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Project, Apartment])],
  providers: [ProjectsService],
  controllers: [ProjectsController],
  exports: [TypeOrmModule, ProjectsService],
})
export class ProjectsModule {}
