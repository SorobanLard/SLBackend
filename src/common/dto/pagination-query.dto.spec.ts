import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MAX_PAGE_SIZE, PaginationQueryDto } from './pagination-query.dto';
import { PendingSubmissionsQueryDto } from '../../modules/assignments/dto/pending-submissions-query.dto';

describe('PaginationQueryDto (Issue #154) — bounds on page and limit', () => {
  const parse = (plain: Record<string, unknown>) =>
    plainToInstance(PaginationQueryDto, plain, { enableImplicitConversion: true });

  const errorProps = async (dto: object): Promise<string[]> =>
    (await validate(dto)).map((e) => e.property);

  it('accepts an empty query and leaves page/limit undefined', async () => {
    const dto = parse({});

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBeUndefined();
    expect(dto.limit).toBeUndefined();
  });

  it('coerces query-string values into numbers', async () => {
    const dto = parse({ page: '2', limit: '50' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
  });

  it('accepts a limit equal to the maximum page size', async () => {
    const dto = parse({ limit: String(MAX_PAGE_SIZE) });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(MAX_PAGE_SIZE);
  });

  it('rejects a limit above the maximum page size', async () => {
    const dto = parse({ limit: String(MAX_PAGE_SIZE + 1) });

    expect(await errorProps(dto)).toContain('limit');
  });

  it('rejects an unbounded limit', async () => {
    const dto = parse({ limit: '999999' });

    expect(await errorProps(dto)).toContain('limit');
  });

  it('rejects a limit below one', async () => {
    const dto = parse({ limit: '0' });

    expect(await errorProps(dto)).toContain('limit');
  });

  it('rejects a page below one', async () => {
    const dto = parse({ page: '0' });

    expect(await errorProps(dto)).toContain('page');
  });

  it('rejects a negative page', async () => {
    const dto = parse({ page: '-1' });

    expect(await errorProps(dto)).toContain('page');
  });

  it('rejects a non-integer limit', async () => {
    const dto = parse({ limit: '10.5' });

    expect(await errorProps(dto)).toContain('limit');
  });

  it('rejects a non-numeric limit', async () => {
    const dto = parse({ limit: 'abc' });

    expect(await errorProps(dto)).toContain('limit');
  });

  it('rejects a non-numeric page', async () => {
    const dto = parse({ page: 'abc' });

    expect(await errorProps(dto)).toContain('page');
  });

  it('propagates the bounds to DTOs that extend it', async () => {
    const dto = plainToInstance(PendingSubmissionsQueryDto, { limit: '999999' });

    expect(await errorProps(dto)).toContain('limit');
  });
});
