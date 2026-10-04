// AA.3b (owner 2026-09-23, mockup approved): how an exploded database reads on
// the canvas. Pure.
//
// A database explodes into groups, never one node per table. The data model
// comes from the technology's catalog row (ai_context.dataModel) and names the
// groups and what they hold: schemas of tables for SQL, groups of collections
// for a document store, groups of key patterns for a key-value store,
// keyspaces of tables for a wide-column store. Collapsed, the database carries
// one strip: "relational · 3 schemas · 41 tables". Expanded, each group is a
// card listing what it holds. Service edges landing on a group say read, write
// or both; a foreign key between groups draws solid, a reference kept by
// convention in code dashed.

export type DataModel = 'relational' | 'document' | 'key-value' | 'wide-column' | 'graph';
export const DATA_MODELS: readonly DataModel[] = ['relational', 'document', 'key-value', 'wide-column', 'graph'];

interface Nouns { group: string; groups: string; item: string; items: string }

const NOUNS: Record<DataModel, Nouns> = {
  relational: { group: 'schema', groups: 'schemas', item: 'table', items: 'tables' },
  document: { group: 'group', groups: 'groups', item: 'collection', items: 'collections' },
  'key-value': { group: 'group', groups: 'groups', item: 'key pattern', items: 'key patterns' },
  'wide-column': { group: 'keyspace', groups: 'keyspaces', item: 'table', items: 'tables' },
  graph: { group: 'group', groups: 'groups', item: 'label', items: 'labels' },
};
/** A store whose technology names no model still groups tables. */
const UNKNOWN: Nouns = { group: 'group', groups: 'groups', item: 'table', items: 'tables' };

export function asDataModel(v: unknown): DataModel | null {
  return typeof v === 'string' && (DATA_MODELS as readonly string[]).includes(v) ? v as DataModel : null;
}

export function nounsFor(model: DataModel | null): Nouns {
  return model ? NOUNS[model] : UNKNOWN;
}

/** What a group lists: a table, a collection, a key pattern. */
export interface GroupEntry {
  name: string;
  columns?: number;
  keys?: string[];
  kind?: string;
  file?: string;
  note?: string;
  /** The artifact that defines it, when the file is bound: clicking opens it. */
  artifactId?: string;
  /** The node that holds that artifact (the group, the database, or a service). */
  artifactNodeId?: string;
}

export interface DataShape { model: DataModel | null; groups: number; items: number }

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 schemas · 29 tables": the counts after the model on the strip. */
export function dataShapeCounts(shape: DataShape): string {
  const n = nounsFor(shape.model);
  return `${count(shape.groups, n.group, n.groups)} · ${count(shape.items, n.item, n.items)}`;
}

/** "schema · 11 tables": under a group's name on its card. */
export function groupMetaText(model: DataModel | null, items: number): string {
  const n = nounsFor(model);
  return `${n.group} · ${count(items, n.item, n.items)}`;
}

/** What a row shows beside (or under) the name. */
export function entryMeta(model: DataModel | null, entry: GroupEntry): string {
  if (model === 'document') return (entry.keys ?? []).join(' · ');
  if (model === 'key-value' || model === 'graph') return entry.kind ?? (entry.keys ?? []).join(' · ');
  if (typeof entry.columns === 'number') return count(entry.columns, 'column', 'columns');
  return entry.kind ?? '';
}

/** Rows shown before "N more" on a card. */
export const ROWS_SHOWN = 6;

export type Access = 'read' | 'write' | 'both';
export function asAccess(v: unknown): Access | null {
  return v === 'read' || v === 'write' || v === 'both' ? v : null;
}
export function accessText(access: Access): string {
  return access === 'both' ? 'read and write' : access;
}

export type Reference = 'foreign_key' | 'code';
export function asReference(v: unknown): Reference | null {
  return v === 'foreign_key' || v === 'code' ? v : null;
}
export function referenceText(ref: Reference): string {
  return ref === 'foreign_key' ? 'foreign key' : 'reference kept in code';
}

type Mode = 'light' | 'dark';
interface Tone { bg: string; fg: string; line: string }

/** The mockup's chip colours, per theme. */
export const ACCESS_TONES: Record<Access, Record<Mode, Tone>> = {
  read: { light: { bg: '#dbeafe', fg: '#1d4ed8', line: '#93c5fd' }, dark: { bg: '#172b4d', fg: '#93c5fd', line: '#1e40af' } },
  write: { light: { bg: '#ffedd5', fg: '#9a3412', line: '#fdba74' }, dark: { bg: '#3d2710', fg: '#fdba74', line: '#9a3412' } },
  both: { light: { bg: '#ede9fe', fg: '#5b21b6', line: '#c4b5fd' }, dark: { bg: '#2a2150', fg: '#c4b5fd', line: '#5b21b6' } },
};

/** A foreign key in the data store's teal; a reference kept in code in the document green, dashed. */
export const REFERENCE_TONES: Record<Reference, Record<Mode, string>> = {
  foreign_key: { light: '#0f766e', dark: '#2dd4bf' },
  code: { light: '#15803d', dark: '#4ade80' },
};
export const REFERENCE_DASH: Record<Reference, string | undefined> = { foreign_key: undefined, code: '6 5' };
