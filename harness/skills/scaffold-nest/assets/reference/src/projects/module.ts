import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/index.js';
import { ProjectsController } from './controller.js';
import { ProjectsRepository } from './repository.js';
import { ProjectsService } from './service.js';
// Exports the service, not the repository: another module that needs project data calls ProjectsService.
@Module({
  imports: [PlatformModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository],
  exports: [ProjectsService],
})
export class ProjectsModule {}
