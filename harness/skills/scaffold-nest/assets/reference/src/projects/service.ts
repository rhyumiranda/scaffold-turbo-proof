import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ProjectResponse, RenamedProjectResponse } from './dto.js';
import { ProjectsRepository, type ProjectRow } from './repository.js';
function dto(row: ProjectRow): ProjectResponse {
  return { id: row.id, name: row.name, version: row.version, createdAt: row.createdAt.toISOString() };
}
@Injectable()
export class ProjectsService {
  constructor(private readonly projects: ProjectsRepository) {}
  async create(owner: string, name: string) {
    return dto(await this.projects.insert(randomUUID(), owner, name));
  }
  async list(owner: string, limit: number, offset: number) {
    return (await this.projects.listByOwner(owner, limit, offset)).map(dto);
  }
  async read(owner: string, id: string) {
    const row = await this.projects.findOwned(owner, id);
    if (!row) throw new NotFoundException();
    return dto(row);
  }
  async rename(owner: string, id: string, name: string, version: number): Promise<RenamedProjectResponse> {
    const row = await this.projects.renameIfVersion(owner, id, name, version);
    if (row) return row;
    await this.read(owner, id);
    throw new ConflictException('Project changed; reload before retrying');
  }
}
