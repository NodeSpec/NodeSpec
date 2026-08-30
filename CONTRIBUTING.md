# Contributing to NodeSpec Community Edition

Thanks for wanting to make NodeSpec better. A few things to know up front so
your time is well spent.

## How this repository works

This public repository is exported from NodeSpec's private monorepo — the
community edition is a first-class build product, not a fork. Pull requests
here are reviewed by a maintainer, applied to the monorepo, and land back in
the next export. Your authorship is preserved in the commit trailer; the
public history is release-shaped rather than commit-for-commit.

## Sign your work (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org/).
Sign each commit with `git commit -s`, which adds:

    Signed-off-by: Your Name <you@example.com>

By signing off you certify you have the right to contribute the code under
this repository's Apache-2.0 license. Contributions may also be included in
NodeSpec's proprietary editions, as Apache-2.0 permits.

## Before you open a PR

1. Run the full gate locally — every change must keep all four green:

       npx tsc --noEmit
       npm test
       npm run test:functions
       npm run build

2. Match the house style you see around your change: tests pin behavior in
   the same file style they already use; comments state constraints, not
   narration.
3. Schema changes: this repository ships a squashed schema plus a starter
   catalog migration. Propose schema changes as a description in the PR —
   maintainers translate them into the monorepo's migration chain so replay
   safety holds everywhere.

## What lives elsewhere

The hosted service (nodespec.io), repo-import reverse visualization, the full
enriched technology catalog, and team/enterprise integrations are proprietary
and out of scope here. Issues about them are welcome; PRs against them can't
be accepted in this repository.

## Security

Please do not open public issues for suspected vulnerabilities — see
SECURITY.md.
