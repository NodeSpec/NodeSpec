// Edition flag: hosted (nodespec.io managed) vs self-hosted builds, with the
// self-hosted side split into community (OSS container) and enterprise (the
// licensed customer bundle).
//
// Social/marketplace write surfaces — publishing to the marketplace, template
// comments, public user profiles — exist only in the hosted edition. A
// self-hosted deployment points at its own Supabase project, so those
// surfaces would write into a marketplace nobody else can see; they are
// compiled out instead. The marketing site (landing tour, pricing, blog,
// government pages) is hosted-only too: self-hosted builds boot to a plain
// sign-in page. The read-only templates gallery additionally ships in the
// enterprise bundle, never in the community container.
//
// The default is deliberately inverted from the other VITE_ vars (which fall
// back to hosted values when absent): an ABSENT var means the community
// self-host edition, so a fork built with no env gets the safe build without
// any configuration. Only the managed site sets VITE_NODESPEC_EDITION="hosted"
// (netlify.toml [context.production.environment]); the customer-bundle build
// lane stamps VITE_NODESPEC_EDITION=enterprise into its selfhost.env.example
// (scripts/selfhost/build-bundle.mjs).
//
// Because these are literal comparisons against import.meta.env, Vite
// dead-code-eliminates branches guarded by them — gated components genuinely
// leave the self-hosted bundle when the guard sits at the render boundary.
export const isHostedEdition = import.meta.env.VITE_NODESPEC_EDITION === 'hosted';
export const isEnterpriseEdition = import.meta.env.VITE_NODESPEC_EDITION === 'enterprise';

/** The templates gallery ships hosted + enterprise; never in community. */
export const hasTemplatesGallery = isHostedEdition || isEnterpriseEdition;

/** The admin portal (and its blog CMS) is a paid surface: hosted + enterprise
 *  only (owner ruling 2026-08-28). The community export replaces the admin and
 *  blog component directories with stubs — this gate keeps every entry point
 *  (route, TopBar button) out of community builds. */
export const hasAdminPortal = isHostedEdition || isEnterpriseEdition;

/** Landing-page label for self-hosted builds; the hosted site has none. */
export const editionLabel = isHostedEdition ? null : isEnterpriseEdition ? 'Enterprise' : 'OSS Community';
