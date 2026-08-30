import { useEffect, useState } from 'react';
import { BlueprintGrid } from './BlueprintGrid.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';

const PRIMARY = '#8B8FE6';
const PRIMARY_LIGHT = 'rgba(139, 143, 230, 0.12)';
const PRIMARY_BORDER = 'rgba(139, 143, 230, 0.2)';
const DARK_BG = '#0f1117';
const DARK_SURFACE = '#1a1d26';

interface TechChip {
  name: string;
  /** technology_catalog id — the chip renders that row's live icon_url, so this
      surface always shows the same storage asset as the real canvas node. */
  techId?: string;
  color: string;      // fallback initial color when no icon resolves
  darkBg?: boolean;
}

interface CatalogCategory {
  title: string;
  blurb: string;
  count: string;      // approximate on purpose — the catalog grows weekly
  accent: string;
  techs: TechChip[];
}

// Curated showcase of the live catalog (300+ technologies, 85+ roles). Counts are
// deliberately "N+" so this marketing surface never lags the real catalog, and
// icons resolve at runtime from technology_catalog.icon_url (the table is
// world-readable) so every chip shows the SAME storage asset as its canvas node
// — never a hard-coded copy that drifts when icons are relinked.
const CATALOG_CATEGORIES: CatalogCategory[] = [
  {
    title: 'Cloud Platforms',
    blurb: 'Full AWS, Azure, GCP and Cloudflare families — services modeled as first-class nodes with placement-aware context.',
    count: '130+',
    accent: '#FF9900',
    techs: [
      { name: 'AWS', techId: 'aws', color: '#FF9900' },
      { name: 'Azure', techId: 'azure', color: '#0078D4' },
      { name: 'Google Cloud', techId: 'gcp', color: '#4285F4' },
      { name: 'Cloudflare', techId: 'cloudflare-workers', color: '#f38020' },
      { name: 'Supabase', techId: 'supabase', color: '#3ECF8E' },
      { name: 'Vercel', techId: 'vercel-edge', color: '#000000' },
    ],
  },
  {
    title: 'Frameworks & Frontends',
    blurb: 'Web, mobile and desktop frameworks with idiomatic file layouts and suggested project structure.',
    count: '25+',
    accent: '#61dafb',
    techs: [
      { name: 'React', techId: 'react', color: '#61dafb' },
      { name: 'Next.js', techId: 'nextjs', color: '#000000' },
      { name: 'Vue', techId: 'vue', color: '#42b883' },
      { name: 'Svelte', techId: 'svelte', color: '#ff3e00' },
      { name: 'Flutter', techId: 'flutter', color: '#02569B' },
      { name: 'Swift', techId: 'swift-ios', color: '#F05138' },
    ],
  },
  {
    title: 'Backends & Runtimes',
    blurb: 'Service backends across every major language, each with framework-aware build guidance.',
    count: '15+',
    accent: '#339933',
    techs: [
      { name: 'Node.js', techId: 'nodejs', color: '#339933' },
      { name: 'Python', techId: 'python-backend', color: '#3776ab' },
      { name: 'Go', techId: 'go-backend', color: '#00add8' },
      { name: 'Rust', techId: 'rust-backend', color: '#dea584' },
      { name: 'Java', techId: 'java-backend', color: '#ed8b00' },
      { name: '.NET', techId: 'dotnet-worker', color: '#512bd4' },
    ],
  },
  {
    title: 'Data & Storage',
    blurb: 'Relational, document, graph, vector and cache stores — schema and connection doctrine included.',
    count: '35+',
    accent: '#336791',
    techs: [
      { name: 'PostgreSQL', techId: 'postgresql', color: '#336791' },
      { name: 'MongoDB', techId: 'mongodb', color: '#47a248' },
      { name: 'Redis', techId: 'redis', color: '#dc382d' },
      { name: 'MySQL', techId: 'mysql', color: '#4479a1' },
      { name: 'Elasticsearch', techId: 'elasticsearch', color: '#fed10a' },
      { name: 'Qdrant', techId: 'qdrant', color: '#DC244C' },
    ],
  },
  {
    title: 'AI & ML',
    blurb: 'Model APIs, self-hosted inference, agent frameworks, vector search and the ML pipeline stack.',
    count: '30+',
    accent: '#D97757',
    techs: [
      { name: 'Anthropic', techId: 'anthropic', color: '#D97757' },
      { name: 'OpenAI', techId: 'openai', color: '#10a37f' },
      { name: 'Ollama', techId: 'ollama', color: '#1a1a2e' },
      { name: 'LangChain', techId: 'langchain', color: '#1c3c3c' },
      { name: 'Pinecone', techId: 'pinecone', color: '#0ECF83', darkBg: true },
      { name: 'MLflow', techId: 'mlflow', color: '#0194E2' },
    ],
  },
  {
    title: 'Messaging & Realtime',
    blurb: 'Event streams, queues, websockets and realtime backends with protocol-true contract vocabulary.',
    count: '15+',
    accent: '#ff6600',
    techs: [
      { name: 'Kafka', techId: 'kafka', color: '#231f20' },
      { name: 'RabbitMQ', techId: 'rabbitmq', color: '#ff6600' },
      { name: 'NATS', techId: 'nats', color: '#27aae1' },
      { name: 'Pusher', techId: 'pusher', color: '#300D4F' },
      { name: 'Ably', techId: 'ably', color: '#FF5416' },
      { name: 'Socket.IO', techId: 'socket-io', color: '#010101' },
    ],
  },
  {
    title: 'DevOps & Observability',
    blurb: 'Containers, orchestration, CI/CD, IaC and the monitoring stack — provisioned-not-programmed done right.',
    count: '25+',
    accent: '#326ce5',
    techs: [
      { name: 'Kubernetes', techId: 'kubernetes', color: '#326ce5' },
      { name: 'Docker', techId: 'docker', color: '#2496ed' },
      { name: 'NGINX', techId: 'nginx', color: '#009639' },
      { name: 'Istio', techId: 'istio', color: '#466bb0' },
      { name: 'Grafana', techId: 'grafana', color: '#F46800' },
      { name: 'Prometheus', techId: 'prometheus', color: '#E6522C' },
    ],
  },
  {
    title: 'Business & SaaS APIs',
    blurb: 'Billing, email, analytics, support and automation services with console setup checklists.',
    count: '30+',
    accent: '#635BFF',
    techs: [
      { name: 'Stripe', techId: 'stripe', color: '#635BFF' },
      { name: 'Twilio', techId: 'twilio', color: '#F22F46' },
      { name: 'SendGrid', techId: 'sendgrid', color: '#1A82E2' },
      { name: 'PostHog', techId: 'posthog', color: '#F9BD2B' },
      { name: 'Shopify', techId: 'shopify', color: '#96BF48' },
      { name: 'Zapier', techId: 'zapier', color: '#FF4A00' },
    ],
  },
  {
    title: 'Game & Desktop',
    blurb: 'Engines, authoritative game servers and desktop shells — client-extractable by doctrine.',
    count: '10+',
    accent: '#478CBF',
    techs: [
      { name: 'Godot', techId: 'godot', color: '#478CBF' },
      { name: 'Unity', techId: 'unity', color: '#000000' },
      { name: 'Unreal', techId: 'unreal-engine', color: '#0E1128' },
      { name: 'Colyseus', techId: 'colyseus', color: '#8E44AD' },
      { name: 'Electron', techId: 'electron', color: '#47848f' },
      { name: 'Tauri', techId: 'tauri', color: '#24C8DB' },
    ],
  },
];

const STATS: { value: string; label: string }[] = [
  { value: '300+', label: 'technologies with curated AI context' },
  { value: '85+', label: 'architectural roles in the ontology' },
  { value: '100%', label: 'of entries verified against the GTM quality bar' },
];

/** All catalog ids the showcase references — fetched in one query on mount. */
const SHOWCASE_TECH_IDS = CATALOG_CATEGORIES.flatMap(cat =>
  cat.techs.map(t => t.techId).filter((id): id is string => !!id),
);

/** id → live icon_url, straight from technology_catalog. */
function useCatalogIcons(): Record<string, string> {
  const [icons, setIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseClient();
        const { data } = await supabase
          .from('technology_catalog')
          .select('id, icon_url')
          .in('id', SHOWCASE_TECH_IDS);
        if (cancelled || !data) return;
        const map: Record<string, string> = {};
        for (const row of data as Array<{ id: string; icon_url: string | null }>) {
          if (row.icon_url) map[row.id] = row.icon_url;
        }
        setIcons(map);
      } catch {
        /* pre-auth marketing surface — chips fall back to initials */
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return icons;
}

function ChipIcon({ tech, iconUrl }: { tech: TechChip; iconUrl?: string }) {
  const [imgError, setImgError] = useState(false);
  const showImg = iconUrl && !imgError;
  return (
    <span style={{
      width: '22px',
      height: '22px',
      borderRadius: '6px',
      overflow: 'hidden',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: showImg ? (tech.darkBg ? '#1a1a1a' : 'transparent') : 'rgba(255,255,255,0.06)',
      flexShrink: 0,
    }}>
      {showImg ? (
        <img
          src={iconUrl}
          alt=""
          onError={() => setImgError(true)}
          style={{ width: '18px', height: '18px', objectFit: 'contain' }}
        />
      ) : (
        <span style={{ fontSize: '9px', fontWeight: 700, color: tech.color }}>
          {tech.name.slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function CategoryCard({ category, icons }: { category: CatalogCategory; icons: Record<string, string> }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '24px',
        borderRadius: '16px',
        border: `1px solid ${hovered ? PRIMARY_BORDER : 'rgba(255,255,255,0.06)'}`,
        backgroundColor: hovered ? 'rgba(139,143,230,0.05)' : DARK_SURFACE,
        transition: 'all 0.18s ease',
        transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
        boxShadow: hovered
          ? '0 10px 28px rgba(139,143,230,0.14)'
          : '0 1px 4px rgba(0,0,0,0.2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span style={{ fontSize: '16px', fontWeight: 700, color: '#E6E9EF', letterSpacing: '-0.01em' }}>
          {category.title}
        </span>
        <span style={{
          fontSize: '12px',
          fontWeight: 700,
          color: category.accent,
          backgroundColor: `${category.accent}18`,
          border: `1px solid ${category.accent}33`,
          padding: '3px 10px',
          borderRadius: '20px',
          whiteSpace: 'nowrap',
        }}>
          {category.count}
        </span>
      </div>
      <p style={{
        fontSize: '13px',
        color: '#8a8f9e',
        lineHeight: 1.55,
        margin: '0 0 16px',
        flexGrow: 1,
      }}>
        {category.blurb}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {category.techs.map(tech => (
          <span key={tech.name} style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '7px',
            padding: '5px 12px 5px 6px',
            borderRadius: '20px',
            backgroundColor: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
            fontSize: '12px',
            fontWeight: 500,
            color: '#c9cdd8',
            whiteSpace: 'nowrap',
          }}>
            <ChipIcon tech={tech} iconUrl={tech.techId ? icons[tech.techId] : undefined} />
            {tech.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function TechEcosystemSection() {
  const icons = useCatalogIcons();
  return (
    <section style={{
      width: '100%',
      backgroundColor: DARK_BG,
      borderTop: '1px solid rgba(139, 143, 230, 0.06)',
      borderBottom: '1px solid rgba(139, 143, 230, 0.06)',
      padding: '80px 0',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <BlueprintGrid variant="dark" density="sparse" showNodes={false} />
      <div style={{
        maxWidth: '1140px',
        margin: '0 auto',
        padding: '0 40px',
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            display: 'inline-block',
            padding: '6px 16px',
            borderRadius: '20px',
            backgroundColor: PRIMARY_LIGHT,
            border: `1px solid ${PRIMARY_BORDER}`,
            fontSize: '12px',
            fontWeight: 600,
            color: PRIMARY,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            marginBottom: '16px',
          }}>
            Technology Catalog
          </div>
          <h2 style={{
            fontSize: '32px',
            fontWeight: 700,
            color: '#E6E9EF',
            letterSpacing: '-0.02em',
            marginBottom: '14px',
            lineHeight: '1.2',
          }}>
            One catalog. Every layer of your stack.
          </h2>
          <p style={{
            fontSize: '17px',
            color: '#8a8f9e',
            maxWidth: '640px',
            margin: '0 auto',
            lineHeight: '1.6',
          }}>
            Every entry carries curated AI context — best practices, anti-patterns,
            security doctrine, setup checklists and live documentation pointers — so the
            task packets your AI builds from are specific, current and honest.
          </p>
        </div>

        {/* Stat strip — replaces the old "12 languages supported" line with numbers
            that actually communicate catalog depth. */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '16px',
          marginBottom: '44px',
        }}>
          {STATS.map(stat => (
            <div key={stat.label} style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '10px',
              padding: '14px 22px',
              borderRadius: '12px',
              backgroundColor: DARK_SURFACE,
              border: '1px solid rgba(255,255,255,0.07)',
            }}>
              <span style={{ fontSize: '26px', fontWeight: 800, color: PRIMARY, letterSpacing: '-0.02em' }}>
                {stat.value}
              </span>
              <span style={{ fontSize: '13px', color: '#8a8f9e', maxWidth: '200px', lineHeight: 1.4 }}>
                {stat.label}
              </span>
            </div>
          ))}
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))',
          gap: '16px',
        }}>
          {CATALOG_CATEGORIES.map(category => (
            <CategoryCard key={category.title} category={category} icons={icons} />
          ))}
        </div>

        <p style={{
          textAlign: 'center',
          marginTop: '36px',
          fontSize: '13px',
          color: '#5a5f78',
        }}>
          Missing something? Community accounts can contribute custom technologies to their own catalog.
        </p>
      </div>
    </section>
  );
}
