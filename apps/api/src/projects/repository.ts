import { Injectable } from '@nestjs/common';
import { Database } from '../platform/index.js';
// The only code that touches the projects module's models (prisma/schema/projects/). Every query is scoped to
// the owner; other modules read projects through ProjectsService, never through this repository or the model.
const columns = { id: true, name: true, version: true, createdAt: true } as const;
export type ProjectRow = { id: string; name: string; version: number; createdAt: Date };
export type RenamedProjectRow = Pick<ProjectRow, 'id' | 'name' | 'version'>;
@Injectable()
export class ProjectsRepository {
  constructor(private readonly db: Database) {}
  insert(id: string, ownerId: string, name: string): Promise<ProjectRow> {
    return this.db.client.project.create({ data: { id, ownerId, name }, select: columns });
  }
  // Newest first; the id breaks ties so paging is stable (index projects_owner_order).
  listByOwner(ownerId: string, take: number, skip: number): Promise<ProjectRow[]> {
    return this.db.client.project.findMany({
      where: { ownerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      skip,
      select: columns,
    });
  }
  findOwned(ownerId: string, id: string): Promise<ProjectRow | null> {
    return this.db.client.project.findFirst({ where: { id, ownerId }, select: columns });
  }
  // Optimistic concurrency in one statement: the row changes only while it still has the expected version.
  async renameIfVersion(ownerId: string, id: string, name: string, version: number): Promise<RenamedProjectRow | null> {
    // The tagged query stays parameterized. Unlike Prisma's bulk mutation helpers, it does not add transaction
    // control round trips, so a delayed database can still finish this single write inside the request deadline.
    const [renamed] = await this.db.client.$queryRaw<RenamedProjectRow[]>`
      UPDATE "projects"
      SET "name" = ${name}, "version" = "version" + 1
      WHERE "id" = ${id}::uuid AND "owner_id" = ${ownerId} AND "version" = ${version}
      RETURNING "id", "name", "version"
    `;
    return renamed ?? null;
  }
}
