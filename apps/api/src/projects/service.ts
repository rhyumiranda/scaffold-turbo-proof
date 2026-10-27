import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Database } from '../platform/index.js';
import type { ProjectResponse } from './dto.js';
type Row = { id: string; name: string; version: number; created_at: Date };
const columns = 'id, name, version, created_at';
function dto(row: Row): ProjectResponse {
  return { id: row.id, name: row.name, version: row.version, createdAt: row.created_at.toISOString() };
}
@Injectable()
export class ProjectsService {
  constructor(private readonly db: Database) {}
  async create(owner: string, name: string) {
    const result = await this.db.query<Row>(
      'INSERT INTO projects (id, owner_id, name) VALUES ($1, $2, $3) RETURNING ' + columns,
      [randomUUID(), owner, name],
    );
    return dto(result.rows[0]!);
  }
  async list(owner: string, limit: number, offset: number) {
    const result = await this.db.query<Row>(
      'SELECT ' + columns + ' FROM projects WHERE owner_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3',
      [owner, limit, offset],
    );
    return result.rows.map(dto);
  }
  async read(owner: string, id: string) {
    const result = await this.db.query<Row>('SELECT ' + columns + ' FROM projects WHERE id=$1 AND owner_id=$2', [
      id,
      owner,
    ]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return dto(row);
  }
  async rename(owner: string, id: string, name: string, version: number) {
    const result = await this.db.query<Row>(
      'UPDATE projects SET name=$3, version=version+1 WHERE id=$1 AND owner_id=$2 AND version=$4 RETURNING ' + columns,
      [id, owner, name, version],
    );
    if (result.rows[0]) return dto(result.rows[0]);
    await this.read(owner, id);
    throw new ConflictException('Project changed; reload before retrying');
  }
}
