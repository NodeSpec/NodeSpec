# Vendored technology icons

This directory is the shipping source of the `icons` storage bucket. Every
deployment — the OSS community container, enterprise self-host boxes, and
fresh installs generally — seeds its **own** Supabase storage from these
files via `scripts/icons/seed-icons.sh` (bootstrap runs it automatically),
then `technology_catalog.icon_url` is repointed at that local bucket. No
deployment hotlinks the hosted nodespec.io bucket: enterprise environments
may be fully air-gapped, and OSS forks run against their own stacks
(owner ruling 2026-09-01).

Folder structure mirrors the bucket exactly (`AWS/`, `GCP/`, `Supabase/`,
flat files). Paths are load-bearing: `technology_catalog.icon_url` references
them relative to the bucket root, and the AWS rows are pinned to
`AWS/Arch_*_64@5x.png` names by migration `20260901120000`.

Refreshing the set (ops machines only — needs the hosted service key):

    node scripts/icons/snapshot-icons.mjs

then commit the changes. Deletions in the bucket are not propagated —
remove retired files by hand. Keep icons small (the 64@5x PNG variants);
this directory ships in the community export.
