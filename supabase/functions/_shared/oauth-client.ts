// AL.2 (owner 2026-10-01: Proposals must show "real information an agent
// will propose or activity it undertakes"). An agent that signs in through
// OAuth was shown by its client id, a random UUID ("oauth · 4b1c2e9a-...")
// on every proposal, hold and roster row. Registration knows the client's
// own name (RFC 7591 client_name: "Claude Code", "Codex") but nothing stores
// it, and no column is added for it: the name goes INTO the client id the
// server mints, as a slug before the UUID ("claude-code.4b1c2e9a-..."), and
// every label reads it back out. A client id is opaque to the client, so the
// shape is ours to choose. A Client ID Metadata Document client's id is its
// metadata URL, named by the URL's host. Older ids (a bare UUID) read as
// their first eight characters, as before.
//
// Pure: imported by the MCP server (registration, labels) and by the app
// (cards, holds, the Connected tab).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUGGED = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The registered name as the slug the client id carries: lower case,
 *  every run of other characters one dash, at most 32 characters. Empty
 *  when the name has nothing to keep. */
export function clientSlug(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
}

/** The client id minted at registration: "<slug>.<uuid>", or the bare UUID
 *  when the client sent no usable name (or the generic default). */
export function oauthClientId(name: string | null | undefined, uuid: string): string {
  const slug = clientSlug(name);
  return slug && slug !== 'mcp-client' ? `${slug}.${uuid}` : uuid;
}

/** The name an OAuth client registered under, read from its id: the slug a
 *  minted id carries, or the host of a metadata-document URL. Null for an
 *  id that names nothing (a bare UUID from before AL.2). */
export function oauthClientKnownName(clientId: string): string | null {
  const id = String(clientId ?? '').trim();
  const slugged = SLUGGED.exec(id);
  if (slugged) return slugged[1];
  if (/^https?:\/\//i.test(id)) {
    try { return new URL(id).hostname; } catch { /* not a URL after all */ }
  }
  return null;
}

/** The name an OAuth client goes by in a label: its known name, else the
 *  first eight characters of a UUID id, else the id cut to 32 characters. */
export function oauthClientName(clientId: string): string {
  const id = String(clientId ?? '').trim();
  return oauthClientKnownName(id) ?? (UUID.test(id) ? id.slice(0, 8) : id.slice(0, 32));
}
