export class Database {
  query(sql: string): unknown[] {
    return [sql];
  }
}
