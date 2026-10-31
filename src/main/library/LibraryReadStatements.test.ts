import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { libraryReadStatement } from './LibraryReadStatements';

it('reuses prepared reads while seeing writes, parameters and schema changes', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE items(value INTEGER); INSERT INTO items VALUES (1)');
    const sql = 'SELECT value FROM items WHERE value >= ?';
    const statement = libraryReadStatement(db, sql);
    expect(libraryReadStatement(db, sql)).toBe(statement);
    expect(statement.all(2)).toEqual([]);
    db.exec('INSERT INTO items VALUES (2); ALTER TABLE items ADD COLUMN label TEXT');
    expect(libraryReadStatement(db, sql).all(2)).toEqual([{ value: 2 }]);
    const other = new Database(':memory:');
    try { expect(libraryReadStatement(other, 'SELECT 1')).not.toBe(libraryReadStatement(db, 'SELECT 1')); }
    finally { other.close(); }
  } finally { db.close(); }
});

it('bounds retained plans and leaves writes uncached', () => {
  const db = new Database(':memory:');
  try {
    const first = libraryReadStatement(db, 'SELECT 0');
    for (let i = 1; i <= 32; i++) libraryReadStatement(db, `SELECT ${i}`);
    expect(libraryReadStatement(db, 'SELECT 0')).not.toBe(first);
    db.exec('CREATE TABLE items(value INTEGER)');
    expect(libraryReadStatement(db, 'INSERT INTO items VALUES (?)')).not.toBe(libraryReadStatement(db, 'INSERT INTO items VALUES (?)'));
  } finally { db.close(); }
});
