// N8.4a-1b (owner 2026-07-27): stray technology-id normalization rides EACH enrichment
// chunk — "consistent naming/id references … between the database references, zod
// schema, and frontend reference" — instead of accumulating for N9b.
//
// The DB rows were renamed by migration 20260727140000 (copy → repoint → delete;
// graph SNAPSHOTS and templates rewritten — graph_patches is append-only + hash-chained
// and is NEVER rewritten). Graphs/patches written before the rename, and in-flight
// proposals, may still carry the old ids, so:
//   · READ boundaries register these as extra map keys pointing at the canonical row
//     (client: catalog-repository techIndex; server mirror: _shared/catalog-loader.ts —
//     keep the two maps identical, enums.ts pattern);
//   · WRITE boundaries canonicalize through the row's own id
//     (server: catalog-node-normalization.techIdCaseInsensitive returns row.id).
// The node.technology zod schema is a free string by design — no enum to update.
// Extend this map in the chunk that renames each family's strays (4b: cosmosdb → …).
export const TECHNOLOGY_ID_ALIASES: Record<string, string> = {
  aurora: 'aws-aurora',
  dynamodb: 'aws-dynamodb',
  ec2: 'aws-ec2',
  // 4a-4b: the baseline stray duplicated the 4a-4 expansion row — merged (canonical
  // kept the enrichment, stray donated its icon) and retired.
  elasticache: 'aws-elasticache',
  // 4b-1: second duplicate pair, caught by step 0 BEFORE shipping (not on the bench).
  cosmosdb: 'azure-cosmos-db',
  // 4b-3: third pair — the row was NAMED "Microsoft Entra ID" while azure-entra-id
  // existed under the same name. Azure AD B2C is past its P2 discontinuation date
  // (2026-03-15) and Entra External ID is the successor, which azure-entra-id's
  // tenantType field already covers.
  'azure-ad-b2c': 'azure-entra-id',
  // 4c-1: the GCP family had FOUR un-prefixed rows, two of them duplicate pairs. The
  // prefix is not cosmetic — provider inference reads it, and that inference is what
  // refuses cross-provider containment, so un-prefixed rows were invisible to the guard.
  gcs: 'gcp-cloud-storage',
  'gcp-cloud-storage-for-archive': 'gcp-cloud-storage',
  firestore: 'gcp-firestore',
  'firebase-firestore': 'gcp-firestore',
  'gce-instance': 'gcp-compute-engine',
  // 4c-5 (owner rulings): Vertex is the arbiter of task AI — the single-API NL row
  // merged into it; openai-assistants retired (Assistants API deprecated for the
  // Responses API, sunset announced 2026-08).
  'gcp-cloud-natural-language-api': 'gcp-vertex-ai',
  'openai-assistants': 'openai',
};

/** Canonical id for a possibly-legacy technology id. */
export function resolveTechnologyId(id: string): string {
  return TECHNOLOGY_ID_ALIASES[id] ?? id;
}
