// V3 AD.3 (finding D23): a change card says who. The sync check reads the
// commits since the last sync; each commit NodeSpec did not write is asked
// for the files it changed, and the card's files are grouped by the author
// of the commits that changed them. With several people and agents
// committing to one branch, "who changed this file" is the first question a
// card has to answer, and the held-work warning needs it to tell a holder's
// own commits from someone else's.
//
// Pure. The sweep does the reading (fetchCommitFiles, at most
// MAX_ATTRIBUTED_COMMITS commits, newest first); a file no read commit
// accounts for is listed as unattributed, never guessed.

export interface AuthorGroup {
  author: string;
  /** Commit shas, oldest first. */
  commits: string[];
  /** The card's files these commits changed, sorted. */
  files: string[];
}

/** Commits asked for their files per sync check; older ones stay unattributed. */
export const MAX_ATTRIBUTED_COMMITS = 30;

export const UNKNOWN_AUTHOR = "unknown author";

export function groupFilesByAuthor(
  commits: Array<{ sha: string; author?: string | null; files: string[] | null }>,
  paths: string[],
): { authors: AuthorGroup[]; unattributed: string[] } {
  const wanted = new Set(paths);
  const groups = new Map<string, { commits: string[]; files: Set<string> }>();
  const attributed = new Set<string>();
  for (const c of commits) {
    if (!c.files) continue;
    const touched = c.files.filter((f) => wanted.has(f));
    if (touched.length === 0) continue;
    const name = (c.author ?? "").trim() || UNKNOWN_AUTHOR;
    const g = groups.get(name) ?? { commits: [], files: new Set<string>() };
    g.commits.push(c.sha);
    for (const f of touched) {
      g.files.add(f);
      attributed.add(f);
    }
    groups.set(name, g);
  }
  return {
    authors: [...groups.entries()].map(([author, g]) => ({ author, commits: g.commits, files: [...g.files].sort() })),
    unattributed: paths.filter((p) => !attributed.has(p)).sort(),
  };
}

/** The card's author line: one name, or the first and how many more. */
export function authorLine(authors: AuthorGroup[]): string | null {
  if (authors.length === 0) return null;
  if (authors.length === 1) return authors[0].author;
  return `${authors[0].author} and ${authors.length - 1} more`;
}
