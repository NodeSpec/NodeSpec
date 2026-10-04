// Content sentinels shared by the server lanes that write add_artifact
// patches without inline bodies.
//
// GIT_CONTENT_SENTINEL marks a bindings-only artifact: the accept path
// (ProposalService → proposal-git-content.ts) pulls the bytes from git at
// payload.metadata.contentSource.ref before any patch lands. It MUST equal
// the constant in mcp-server/tools/proposals.ts and the client mirror —
// pinned by tests in both runtimes.

export const GIT_CONTENT_SENTINEL = "__nodespec_git_content__";

/** payload.metadata.contentSource for a bindings-only artifact. */
export function gitContentSource(ref: string): { type: "git"; ref: string } {
  return { type: "git", ref };
}
