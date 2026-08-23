// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { getDocumentKind, openFile, queryParquet, readParquet, readParquetPage } from '../src/main/file-service';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

/** Writes a real Parquet file with `rowCount` rows and returns its path. */
async function writeFixture(rowCount: number): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'orbit-pq-'));
  tempDirectories.push(directory);
  const filePath = path.join(directory, 'people.parquet');
  const names: string[] = [];
  const ages = new Int32Array(rowCount);
  for (let i = 0; i < rowCount; i++) {
    names.push(`Person ${i}`);
    ages[i] = 20 + i;
  }
  const buffer = parquetWriteBuffer({
    columnData: [
      { name: 'name', data: names },
      { name: 'age', data: ages },
      { name: 'active', data: Array.from({ length: rowCount }, (_, i) => i % 2 === 0) },
    ],
  });
  await writeFile(filePath, new Uint8Array(buffer));
  return filePath;
}

describe('parquet viewer', () => {
  it('recognizes the .parquet extension', () => {
    expect(getDocumentKind('data.parquet')).toBe('parquet');
    expect(getDocumentKind('data.PARQUET')).toBe('parquet');
  });

  it('routes parquet through the data viewer and text files through the document reader', async () => {
    const filePath = await writeFixture(5);
    const parquetDoc = await openFile(filePath);
    expect(parquetDoc).toMatchObject({ kind: 'parquet', totalRows: 5, pageSize: 100 });
    const markdownPath = path.join(path.dirname(filePath), 'notes.md');
    await writeFile(markdownPath, '# Notes');
    const markdownDoc = await openFile(markdownPath);
    expect(markdownDoc).toMatchObject({ kind: 'markdown', content: '# Notes' });
  });

  it('reads schema, row count, and the first page', async () => {
    const filePath = await writeFixture(250);
    const doc = await readParquet(filePath);
    expect(doc).toMatchObject({ kind: 'parquet', name: 'people.parquet', totalRows: 250, pageSize: 100 });
    expect(doc.columns).toEqual([
      { name: 'name', type: expect.stringMatching(/string|utf8|byte_array/) },
      { name: 'age', type: 'int32' },
      { name: 'active', type: 'boolean' },
    ]);
    expect(doc.rows).toHaveLength(100);
    expect(doc.rows[0]).toMatchObject({ name: 'Person 0', age: 20, active: true });
    expect(doc.rows[99]).toMatchObject({ name: 'Person 99' });
    expect(doc.fileSize).toBeGreaterThan(0);
    expect(doc.updatedAt).toBeGreaterThan(0);
  });

  it('reads later pages on demand', async () => {
    const filePath = await writeFixture(250);
    const second = await readParquetPage(filePath, 100, 200);
    expect(second.rows).toHaveLength(100);
    expect(second.rows[0]).toMatchObject({ name: 'Person 100', age: 120 });
    const last = await readParquetPage(filePath, 200, 250);
    expect(last.rows).toHaveLength(50);
    expect(last.rows[49]).toMatchObject({ name: 'Person 249' });
  });

  it('returns an empty page for out-of-range reads', async () => {
    const filePath = await writeFixture(10);
    expect((await readParquetPage(filePath, 10, 20)).rows).toEqual([]);
    expect((await readParquetPage(filePath, 5, 5)).rows).toEqual([]);
  });

  it('queries pages lazily when no filter or sort is set', async () => {
    const filePath = await writeFixture(250);
    const page = await queryParquet(filePath, { page: 3 });
    expect(page.rows).toHaveLength(50);
    expect(page.totalMatching).toBe(250);
    expect(page.page).toBe(3);
    expect(page.truncated).toBe(false);
    expect(page.rows[0]).toMatchObject({ name: 'Person 200' });
  });

  it('filters rows across all columns, case-insensitively', async () => {
    const filePath = await writeFixture(50);
    // Every whitespace-separated term must match some column: names contain
    // "person", and the digit 7 also appears in ages (27, 37, ...), so the
    // matching rows are exactly Person 7, 17, 27, 37, 47.
    const page = await queryParquet(filePath, { page: 1, filter: 'PERSON 7' });
    expect(page.totalMatching).toBe(5);
    expect(page.rows.map((row) => row.name)).toEqual(['Person 7', 'Person 17', 'Person 27', 'Person 37', 'Person 47']);
    const none = await queryParquet(filePath, { page: 1, filter: 'zzz-not-present' });
    expect(none.totalMatching).toBe(0);
    expect(none.rows).toEqual([]);
  });

  it('sorts by a column ascending and descending', async () => {
    const filePath = await writeFixture(50);
    const asc = await queryParquet(filePath, { page: 1, sortColumn: 'age', sortDirection: 'asc' });
    expect(asc.rows[0]).toMatchObject({ age: 20 });
    expect(asc.rows[49]).toMatchObject({ age: 69 });
    const desc = await queryParquet(filePath, { page: 1, sortColumn: 'age', sortDirection: 'desc' });
    expect(desc.rows[0]).toMatchObject({ age: 69 });
    expect(desc.rows[49]).toMatchObject({ age: 20 });
  });

  it('pages through filtered results', async () => {
    const filePath = await writeFixture(250);
    const page = await queryParquet(filePath, { page: 2, filter: 'person' });
    expect(page.totalMatching).toBe(250);
    expect(page.rows).toHaveLength(100);
    expect(page.rows[0]).toMatchObject({ name: 'Person 100' });
  });

  it('handles an empty parquet file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'orbit-pq-'));
    tempDirectories.push(directory);
    const filePath = path.join(directory, 'empty.parquet');
    const buffer = parquetWriteBuffer({ columnData: [{ name: 'a', data: [] }] });
    await writeFile(filePath, new Uint8Array(buffer));
    const doc = await readParquet(filePath);
    expect(doc.totalRows).toBe(0);
    expect(doc.rows).toEqual([]);
    expect(doc.columns).toEqual([{ name: 'a', type: expect.stringMatching(/string|utf8|byte_array/) }]);
  });
});
