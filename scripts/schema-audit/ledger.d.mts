export declare const FORWARD_REFS: Set<string>;
export declare function applyMigration(sql: string, tables: Set<string>): Set<string>;
export declare function finalTables(migrationsDir: string): Set<string>;
export declare function codeTableRefs(
  root: string,
  dirs: string[],
  opts?: { skipTests?: boolean },
): Map<string, string[]>;
export declare function missingTableRefs(
  refs: Map<string, string[]>,
  tables: Set<string>,
  allow?: Set<string>,
): Array<{ table: string; sites: string[] }>;
