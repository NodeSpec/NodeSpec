/*
  Community edition stub (owner ruling 2026-08-28).

  The admin portal is a paid surface: it ships only in the hosted and
  enterprise editions, so the community export carries none of its code —
  this stub satisfies App.tsx's static import and nothing else. Every entry
  point (the /admin route, the TopBar Admin button) is gated behind
  hasAdminPortal (src/ui/config/edition.ts), which is false in this build,
  so these components never render.

  Self-hosted user administration is done directly against the stack — see
  the deploy guide (deploy/selfhost/README.md).
*/
export function AdminDashboard(): null {
  return null;
}

export function ProvisioningMonitoringPanel(): null {
  return null;
}
