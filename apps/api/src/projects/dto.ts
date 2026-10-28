import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
export class CreateProject {
  @ApiProperty({ minLength: 1, maxLength: 100, pattern: '^[^\\u0000]*$' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  @Matches(/\S/)
  @Matches(/^[^\u0000]*$/, { message: 'Remove the null character from the name.' })
  name!: string;
}
export class RenameProject extends CreateProject {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;
}
// Query values arrive as strings. An empty or non-numeric value must fail validation, not silently become 0.
const strictInteger = ({ value }: { value: unknown }) =>
  value === undefined
    ? undefined
    : typeof value === 'string' && /^-?\d+$/.test(value)
      ? Number(value)
      : typeof value === 'number'
        ? value
        : Number.NaN;
export class ListProjects {
  @ApiProperty({ type: 'integer', required: false, default: 25, minimum: 1, maximum: 100 })
  @Transform(strictInteger)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;
  @ApiProperty({ type: 'integer', required: false, default: 0, minimum: 0, maximum: 10000 })
  @Transform(strictInteger)
  @IsInt()
  @Min(0)
  @Max(10000)
  offset: number = 0;
}
export class ProjectResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
