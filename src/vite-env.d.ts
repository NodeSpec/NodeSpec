/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** "hosted" on the managed nodespec.io build; absent = self-hosted (social features off). */
  readonly VITE_NODESPEC_EDITION?: string;
  /** The MCP server's public address when the deployment names one (community container, self-host); absent = the Supabase function. */
  readonly VITE_MCP_PUBLIC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
