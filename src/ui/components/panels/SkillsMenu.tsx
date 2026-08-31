// Skills quick-copy menu (owner request 2026-08-13).
//
// Skills are the instructions a user attaches to THEIR AI so it knows how to
// work with NodeSpec before it makes a single call. They live in the public
// open-source repo (github.com/NodeSpec/NodeSpec/skills), one directory per
// skill, so new architecture-specific packs published there appear here with
// no app deploy. This menu lists what is in that folder and copies a skill's
// text to the clipboard in one click.
//
// Read-only, unauthenticated GitHub calls: the listing is one request, and a
// skill body is one more on copy. The listing is cached for the session so
// reopening the menu costs nothing (the unauthenticated rate limit is per IP
// and shared with everything else on the machine).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';

const SKILLS_REPO = 'NodeSpec/NodeSpec';
export const SKILLS_BROWSE_URL = `https://github.com/${SKILLS_REPO}/tree/HEAD/skills`;
const contentsUrl = (path: string) =>
  `https://api.github.com/repos/${SKILLS_REPO}/contents/${path}`;
// v2 (owner bug 2026-08-14): v1 assumed one exact shape — skills/<dir>/SKILL.md
// on a branch literally named main — and silently showed "no skills" for
// anything else. v2 accepts loose .md files AND directories, resolves the file
// inside a directory case-insensitively at copy time, uses the API's own
// download_url (branch-agnostic), and never caches an empty listing so a
// just-pushed skill appears without a new browser session.
const CACHE_KEY = 'nodespec.skills.listing.v2';

interface SkillEntry {
  /** Path segment under skills/ — a directory name or a loose file name. */
  dir: string;
  label: string;
  kind: 'dir' | 'file';
  /** Present for loose files: the API's branch-agnostic raw URL. */
  downloadUrl?: string;
}

/** `nodespec-developer` → `NodeSpec Developer`; `aws-architecture` → `AWS Architecture`. */
function prettify(dir: string): string {
  const ACRONYMS = new Set(['aws', 'gcp', 'ai', 'ml', 'api', 'iac', 'ci', 'cd', 'sql', 'ui', 'ux', 'oss']);
  return dir
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === 'nodespec') return 'NodeSpec';
      if (ACRONYMS.has(lower)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; skills: SkillEntry[] }
  | { status: 'error'; message: string };

export function SkillsMenu({ buttonStyle }: { buttonStyle: React.CSSProperties }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [copied, setCopied] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as SkillEntry[];
        if (parsed.length > 0) {
          setState({ status: 'ready', skills: parsed });
          return;
        }
        // Empty cache entries are never trusted — refetch live.
      }
    } catch { /* fall through to a live fetch */ }
    setState({ status: 'loading' });
    try {
      // Folder name tolerance: skills/ first, Skills/ as the fallback.
      let res = await fetch(contentsUrl('skills'), { headers: { Accept: 'application/vnd.github+json' } });
      if (res.status === 404) {
        res = await fetch(contentsUrl('Skills'), { headers: { Accept: 'application/vnd.github+json' } });
      }
      if (res.status === 404) {
        setState({ status: 'ready', skills: [] });
        return;
      }
      if (res.status === 403) {
        setState({ status: 'error', message: 'GitHub rate limit reached. Browse the skills on GitHub instead.' });
        return;
      }
      if (!res.ok) {
        setState({ status: 'error', message: `Could not reach GitHub (${res.status}).` });
        return;
      }
      const rows = (await res.json()) as Array<{ name: string; path: string; type: string; download_url?: string | null }>;
      const skills: SkillEntry[] = rows
        .filter((r) =>
          r.type === 'dir' ||
          (r.type === 'file' && /\.md$/i.test(r.name) && !/^readme\.md$/i.test(r.name)))
        .map((r) => r.type === 'dir'
          ? { dir: r.path, label: prettify(r.name), kind: 'dir' as const }
          : { dir: r.path, label: prettify(r.name.replace(/\.md$/i, '')), kind: 'file' as const, downloadUrl: r.download_url ?? undefined })
        .sort((a, b) => {
          // The core skill leads; everything else alphabetical.
          const aCore = /core|developer/i.test(a.dir) ? 0 : 1;
          const bCore = /core|developer/i.test(b.dir) ? 0 : 1;
          return aCore - bCore || a.label.localeCompare(b.label);
        });
      if (skills.length > 0) sessionStorage.setItem(CACHE_KEY, JSON.stringify(skills));
      setState({ status: 'ready', skills });
    } catch {
      setState({ status: 'error', message: 'Could not reach GitHub. Check your connection.' });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // Retry on every open unless we already hold a non-empty listing — an
    // empty or errored result must not stick for the whole session.
    if (state.status === 'idle' || state.status === 'error' ||
        (state.status === 'ready' && state.skills.length === 0)) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const fetchSkillText = useCallback(async (skill: SkillEntry): Promise<string> => {
    let fileUrl = skill.downloadUrl;
    if (!fileUrl) {
      // Directory skill: resolve its markdown at use time, case-insensitively
      // (SKILL.md preferred, else the first .md), via the API's download_url
      // so the default branch never matters.
      const res = await fetch(contentsUrl(skill.dir), { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(String(res.status));
      const rows = (await res.json()) as Array<{ name: string; type: string; download_url?: string | null }>;
      const files = rows.filter((r) => r.type === 'file' && /\.md$/i.test(r.name));
      const pick = files.find((r) => /^skill\.md$/i.test(r.name)) ?? files[0];
      if (!pick?.download_url) throw new Error('no markdown in skill directory');
      fileUrl = pick.download_url;
    }
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(String(res.status));
    return await res.text();
  }, []);

  const copySkill = useCallback(async (skill: SkillEntry) => {
    setCopyError(null);
    try {
      const text = await fetchSkillText(skill);
      await navigator.clipboard.writeText(text);
      setCopied(skill.dir);
      setTimeout(() => setCopied((cur) => (cur === skill.dir ? null : cur)), 2000);
    } catch {
      setCopyError(skill.dir);
      setTimeout(() => setCopyError((cur) => (cur === skill.dir ? null : cur)), 3000);
    }
  }, [fetchSkillText]);

  // Download lane (owner UX ruling 2026-08-29): the same markdown as Copy,
  // saved as a .md file — for AI tools that take skill FILES rather than
  // pasted text (Claude Code's skills dir, Cursor rules, a repo commit).
  const downloadSkill = useCallback(async (skill: SkillEntry) => {
    setCopyError(null);
    try {
      const text = await fetchSkillText(skill);
      const base = (skill.dir.split('/').pop() ?? 'skill').replace(/\.md$/i, '');
      const blob = new Blob([text], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${base}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDownloaded(skill.dir);
      setTimeout(() => setDownloaded((cur) => (cur === skill.dir ? null : cur)), 2000);
    } catch {
      setCopyError(skill.dir);
      setTimeout(() => setCopyError((cur) => (cur === skill.dir ? null : cur)), 3000);
    }
  }, [fetchSkillText]);

  return (
    <div ref={wrapRef} data-tour="skills" style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Skills — copy or download a NodeSpec skill for your AI assistant"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          ...buttonStyle,
          width: 'auto',
          padding: '0 12px',
          fontSize: '12px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          ...(open ? { backgroundColor: c.primary, color: '#ffffff', borderColor: c.primary } : {}),
        }}
      >
        Skills
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: '320px', maxHeight: '420px', overflowY: 'auto',
            backgroundColor: c.surface, border: `1px solid ${c.border}`,
            borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
            zIndex: 1000, padding: '8px',
          }}
        >
          <div style={{ padding: '8px 10px 10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: c.text }}>Skills for your AI</div>
            <div style={{ fontSize: '12px', color: c.textMuted, lineHeight: 1.5, marginTop: '4px' }}>
              Copy one into your assistant so it knows how to work with NodeSpec.
            </div>
          </div>

          {state.status === 'loading' && (
            <div style={{ padding: '12px 10px', fontSize: '12px', color: c.textMuted }}>Loading skills…</div>
          )}

          {state.status === 'error' && (
            <div style={{ padding: '12px 10px', fontSize: '12px', color: c.textMuted, lineHeight: 1.5 }}>
              {state.message}
            </div>
          )}

          {state.status === 'ready' && state.skills.length === 0 && (
            <div style={{ padding: '12px 10px', fontSize: '12px', color: c.textMuted, lineHeight: 1.5 }}>
              No skills published yet. They will appear here as they land in the repo.
            </div>
          )}

          {state.status === 'ready' && state.skills.map((skill) => (
            <div
              key={skill.dir}
              role="menuitem"
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '10px', padding: '7px 10px', marginBottom: '2px',
                borderRadius: '7px', color: c.text, fontSize: '13px',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = c.surfaceHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span style={{ fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {skill.label}
              </span>
              <span style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                <button
                  onClick={() => void copySkill(skill)}
                  title={`Copy ${skill.label} to the clipboard`}
                  style={{
                    fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
                    padding: '4px 9px', borderRadius: '6px', border: `1px solid ${c.border}`,
                    backgroundColor: 'transparent',
                    color: copyError === skill.dir ? '#dc2626' : copied === skill.dir ? '#16a34a' : c.textMuted,
                  }}
                >
                  {copyError === skill.dir ? 'Failed' : copied === skill.dir ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={() => void downloadSkill(skill)}
                  title={`Download ${skill.label} as a .md file`}
                  style={{
                    fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
                    padding: '4px 9px', borderRadius: '6px', border: `1px solid ${c.border}`,
                    backgroundColor: 'transparent',
                    color: downloaded === skill.dir ? '#16a34a' : c.textMuted,
                  }}
                >
                  {downloaded === skill.dir ? 'Saved' : '.md'}
                </button>
              </span>
            </div>
          ))}

          <a
            href={SKILLS_BROWSE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'block', marginTop: '6px', padding: '9px 10px',
              borderTop: `1px solid ${c.border}`,
              fontSize: '12px', color: c.primary, textDecoration: 'none', fontWeight: 500,
            }}
          >
            Browse all skills on GitHub →
          </a>
        </div>
      )}
    </div>
  );
}
