import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/index.js';
import { ProjectsController } from './controller.js';
import { ProjectsService } from './service.js';
@Module({ imports: [PlatformModule], controllers: [ProjectsController], providers: [ProjectsService] })
export class ProjectsModule {}
