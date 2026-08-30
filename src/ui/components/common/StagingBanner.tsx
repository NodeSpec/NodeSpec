// Task SB-3: unmistakable visual marker that this is the staging bench, never
// production. Renders ONLY in dev builds (the bench runs `npm run dev`);
// production builds compile this to nothing.
export function StagingBanner() {
  if (!import.meta.env.DEV) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 99999,
        backgroundColor: '#b45309',
        color: '#ffffff',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.12em',
        padding: '2px 14px',
        borderRadius: '0 0 6px 6px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        pointerEvents: 'none',
      }}
    >
      STAGING BENCH
    </div>
  );
}
