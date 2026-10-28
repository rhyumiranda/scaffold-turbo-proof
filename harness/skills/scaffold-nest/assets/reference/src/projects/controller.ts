import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiProblems } from '../platform/index.js';
import type { IdentityRequest } from '../platform/index.js';
import { CreateProject, ListProjects, ProjectResponse, RenamedProjectResponse, RenameProject } from './dto.js';
import { ProjectsService } from './service.js';
@ApiTags('projects')
@ApiBearerAuth()
@Controller({ path: 'projects', version: '1' })
@ApiProblems(400, 401, 404, 408, 409, 413, 415, 429, 500, 503)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}
  @Post()
  @ApiCreatedResponse({ type: ProjectResponse })
  create(@Req() request: IdentityRequest, @Body() input: CreateProject) {
    return this.projects.create(request.identity.subject, input.name);
  }
  @Get()
  @ApiOkResponse({ type: [ProjectResponse] })
  list(@Req() request: IdentityRequest, @Query() query: ListProjects) {
    return this.projects.list(request.identity.subject, query.limit, query.offset);
  }
  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ProjectResponse })
  read(@Req() request: IdentityRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.read(request.identity.subject, id);
  }
  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RenamedProjectResponse })
  rename(@Req() request: IdentityRequest, @Param('id', ParseUUIDPipe) id: string, @Body() input: RenameProject) {
    return this.projects.rename(request.identity.subject, id, input.name, input.expectedVersion);
  }
}
