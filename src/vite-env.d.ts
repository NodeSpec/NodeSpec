/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** "hosted" on the managed nodespec.io build; absent = self-hosted (social features off). */
  readonly VITE_NODESPEC_EDITION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
