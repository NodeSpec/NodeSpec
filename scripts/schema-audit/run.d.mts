export interface StaticReport {
  ledger_tables: string[];
  code_refs: number;
  missing_table_refs: Array<{ table: string; sites: string[] }>;
  stale_forward_refs: string[];
}
export interface CatalogReport {
  tables: number;
  functions: number;
  triggers: number;
  db_tables: string[];
  functions_missing_relations: Array<{ function: string; relation: string }>;
  duplicate_trigger_functions: string[][];
  unindexed_fks: Array<{ table: string; column: string; references: string }>;
  rls_no_policy_uncommented: string[];
  rls_disabled: string[];
  uncommented_tables: string[];
  islands: Array<{ table: string; commented: boolean }>;
  soft_id_columns: Array<{ table: string; column: string; type: string; commented: boolean }>;
}
export interface Drift { in_db_not_in_migrations: string[]; in_migrations_not_in_db: string[] }
export interface Report { static?: Partial<StaticReport>; catalog?: Partial<CatalogReport>; drift?: Partial<Drift> }
export declare function staticReport(root?: string): StaticReport;
export declare function catalogReport(databaseUrl?: string): CatalogReport;
export declare function driftBetween(ledgerTables: Iterable<string>, dbTables: Iterable<string>): Drift;
export declare function classify(report: Report): { hard: string[]; warn: string[] };
