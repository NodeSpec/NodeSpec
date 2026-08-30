// N9b-2: a failed catalog load must be VISIBLE. Before this banner, the DB load
// failure was swallowed at every call site while the static registries silently
// served stale hardcoded data — schemas, containment and packets all subtly wrong
// with nothing telling the user why. Renders only in the 'failed' state; the app
// stays usable (functional degradation), the state just stops being secret.
import { useEffect, useState } from 'react';
import { CatalogService, type CatalogLoadState } from '../../services/CatalogService.js';

export function DegradedCatalogBanner() {
  const [state, setState] = useState<CatalogLoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => CatalogService.subscribeLoadState((s, e) => {
    setState(s);
    setError(e);
    if (s !== 'loading') setRetrying(false);
  }), []);

  if (state !== 'failed' && state !== 'degraded') return null;

  // N8.5″(b): two severities, one banner. 'failed' (red) = no live catalog at all;
  // 'degraded' (amber) = the catalog LOADED but the M5 read gate skipped rows — the
  // palette and packets are missing entries, and before this state the only witness
  // was a console.warn.
  const failed = state === 'failed';

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99998,
        backgroundColor: failed ? '#991b1b' : '#92400e',
        color: '#ffffff',
        fontSize: '12px',
        fontWeight: 600,
        padding: '6px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <span>
        {failed ? (
          <>
            ⚠ Technology catalog failed to load — running on built-in fallback data.
            Node schemas, containment and task packets may be stale or wrong.
            {error ? ` (${error})` : ''}
          </>
        ) : (
          <>⚠ Catalog loaded DEGRADED — {error ?? 'some rows failed validation and were skipped.'}</>
        )}
      </span>
      <button
        onClick={() => {
          setRetrying(true);
          CatalogService.retryLoad().catch(() => {});
        }}
        disabled={retrying}
        style={{
          backgroundColor: '#ffffff',
          color: failed ? '#991b1b' : '#92400e',
          border: 'none',
          borderRadius: '4px',
          padding: '2px 10px',
          fontSize: '12px',
          fontWeight: 700,
          cursor: retrying ? 'wait' : 'pointer',
        }}
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}
