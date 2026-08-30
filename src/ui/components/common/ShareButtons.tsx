// Copy-link + social share intents for public marketplace pages (hosted
// edition). Plain intent URLs — no SDKs; the interesting part of a share is
// the og:image architecture card the crawlers fetch, not the button.
import { useCallback, useState } from 'react';

const ACCENT = '#8B8FE6';

const BUTTON_STYLE: React.CSSProperties = {
  padding: '6px 14px', fontSize: '12.5px', fontWeight: 600, borderRadius: '8px',
  border: '1px solid rgba(139, 143, 230, 0.3)', backgroundColor: 'transparent',
  color: '#4b5563', cursor: 'pointer', textDecoration: 'none',
  display: 'inline-flex', alignItems: 'center', gap: '6px',
};

export function ShareButtons({ url, text }: { url: string; text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }, [url]);

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        onClick={() => void handleCopy()}
        style={{ ...BUTTON_STYLE, color: copied ? '#16a34a' : '#4b5563' }}
      >
        {copied ? 'Link copied' : 'Copy link'}
      </button>
      <a
        href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noopener noreferrer"
        style={BUTTON_STYLE}
      >
        Share on LinkedIn
      </a>
      <a
        href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ ...BUTTON_STYLE, color: ACCENT }}
      >
        Share on X
      </a>
    </div>
  );
}
