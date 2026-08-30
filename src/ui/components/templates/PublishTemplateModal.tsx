// Publish to NodeSpec Marketplace (hosted edition only — the Export popup
// card that opens this is gated on isHostedEdition).
//
// The modal's inputs populate project_templates fields directly; the write
// itself goes through the publish-template edge function, which re-strips
// artifact source code, computes counts/technologies, and owns slugs.
// A project remembers its published template in projects.metadata
// .publishedTemplateId, so reopening the modal becomes "update" — same
// marketplace row, bumped version, stable share link.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import type { Graph } from '@nodespec/core/types.js';
import {
  foldSpecificationForTemplate,
  parseTagsInput,
  sanitizeGraphForPublish,
  type FoldMappingInput,
  type FoldRequirementInput,
  type FoldSpecificationInput,
} from '../../utils/build-template-publish.js';

const CATEGORIES = [
  'general',
  'saas',
  'e-commerce',
  'microservices',
  'iot',
  'mobile',
  'data-pipeline',
  'real-time',
  'ai-ml',
  'devops',
] as const;

interface PublishTemplateModalProps {
  graph: Graph;
  projectId: string;
  projectName: string;
  specification: FoldSpecificationInput | null;
  requirements: FoldRequirementInput[];
  mappingsByRequirement: Map<string, FoldMappingInput[]>;
  onClose: () => void;
}

interface PublishedTemplateInfo {
  id: string;
  slug: string;
  name: string;
  version: string;
}

export function PublishTemplateModal({
  graph,
  projectId,
  projectName,
  specification,
  requirements,
  mappingsByRequirement,
  onClose,
}: PublishTemplateModalProps) {
  const { theme } = useTheme();
  const c = theme.colors;

  const [name, setName] = useState(projectName);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('general');
  const [tagsText, setTagsText] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [includeSpec, setIncludeSpec] = useState(true);
  const [projectMetadata, setProjectMetadata] = useState<Record<string, unknown>>({});
  const [existing, setExisting] = useState<PublishedTemplateInfo | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<PublishedTemplateInfo | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const foldedSpec = useMemo(
    () => foldSpecificationForTemplate(specification, requirements, mappingsByRequirement),
    [specification, requirements, mappingsByRequirement]
  );

  // Prior publication check: the project's metadata points at its marketplace
  // row; a deleted row falls back to a fresh publish.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseClient();
        const { data: project } = await supabase
          .from('projects')
          .select('metadata')
          .eq('id', projectId)
          .maybeSingle();
        if (cancelled) return;
        const metadata = (project?.metadata ?? {}) as Record<string, unknown>;
        setProjectMetadata(metadata);
        const templateId = metadata.publishedTemplateId;
        if (typeof templateId === 'string' && templateId.length > 0) {
          const { data: template } = await supabase
            .from('project_templates')
            .select('id, slug, name, version')
            .eq('id', templateId)
            .maybeSingle();
          if (cancelled) return;
          if (template) {
            setExisting(template as PublishedTemplateInfo);
            setName((template as PublishedTemplateInfo).name);
          }
        }
      } catch {
        // Treat lookup failures as "not published yet" — publish still works.
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const templateUrl = published
    ? `https://nodespec.io/templates/${published.slug}`
    : null;

  const handleSubmit = useCallback(async () => {
    setError(null);
    if (!name.trim()) { setError('Template name is required.'); return; }
    if (!description.trim()) { setError('Description is required.'); return; }
    setSubmitting(true);
    try {
      const supabase = getSupabaseClient();
      const body: Record<string, unknown> = {
        mode: existing ? 'update' : 'create',
        name: name.trim(),
        description: description.trim(),
        category,
        tags: parseTagsInput(tagsText),
        repoUrl: repoUrl.trim() || null,
        graphData: sanitizeGraphForPublish(graph),
        templateSpecification: includeSpec ? foldedSpec : null,
      };
      if (existing) body.templateId = existing.id;

      const { data, error: invokeError } = await supabase.functions.invoke(
        'publish-template',
        { body }
      );
      if (invokeError) {
        // FunctionsHttpError carries the response; surface the server's message.
        let message = invokeError.message;
        const ctx = (invokeError as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const payload = await ctx.json();
            if (payload?.error) message = payload.error;
          } catch { /* keep the generic message */ }
        }
        setError(message || 'Publish failed.');
        return;
      }
      const template = (data as { template?: PublishedTemplateInfo })?.template;
      if (!template) {
        setError((data as { error?: string })?.error ?? 'Publish failed.');
        return;
      }

      // Remember the link project → marketplace row so the next open updates
      // in place. Best-effort: a metadata write failure must not undo the UX
      // of a successful publish.
      try {
        await supabase
          .from('projects')
          .update({ metadata: { ...projectMetadata, publishedTemplateId: template.id } })
          .eq('id', projectId);
      } catch { /* non-fatal */ }

      setPublished(template);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed.');
    } finally {
      setSubmitting(false);
    }
  }, [name, description, category, tagsText, repoUrl, includeSpec, foldedSpec, graph, existing, projectId, projectMetadata]);

  const handleCopyLink = useCallback(async () => {
    if (!templateUrl) return;
    try {
      await navigator.clipboard.writeText(templateUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }, [templateUrl]);

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: '13px',
    border: `1px solid ${c.border}`, borderRadius: '8px',
    backgroundColor: c.background, color: c.text, boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '12px', fontWeight: 600,
    color: c.textSecondary, marginBottom: '5px',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 10000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '520px', maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          backgroundColor: c.surface, borderRadius: '14px', border: `1px solid ${c.border}`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          padding: '18px 24px 14px', borderBottom: `1px solid ${c.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: c.text }}>
              {published
                ? 'Published to the Marketplace'
                : existing
                  ? 'Update your published template'
                  : 'Publish to NodeSpec Marketplace'}
            </div>
            {!published && existing && (
              <div style={{ fontSize: '12px', color: c.textMuted, marginTop: '4px' }}>
                Currently live as “{existing.name}” v{existing.version} — publishing updates the same listing.
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: '20px', lineHeight: 1,
            color: c.textMuted, cursor: 'pointer', padding: '2px 6px', borderRadius: '4px',
          }}>&times;</button>
        </div>

        {published ? (
          <div style={{ padding: '20px 24px', overflowY: 'auto' }}>
            <p style={{ fontSize: '13px', color: c.text, lineHeight: 1.5, margin: '0 0 12px' }}>
              “{published.name}” v{published.version} is live in the community marketplace.
            </p>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 12px', borderRadius: '8px',
              border: `1px solid ${c.border}`, backgroundColor: c.background,
            }}>
              <span style={{
                flex: 1, fontSize: '12.5px', color: c.textSecondary,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {templateUrl}
              </span>
              <button
                onClick={handleCopyLink}
                style={{
                  padding: '5px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '6px',
                  border: `1px solid ${c.border}`, backgroundColor: c.surface,
                  color: linkCopied ? '#16a34a' : c.text, cursor: 'pointer', flexShrink: 0,
                }}
              >
                {linkCopied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <a
                href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(templateUrl ?? '')}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '6px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '6px',
                  border: `1px solid ${c.border}`, color: c.text, textDecoration: 'none',
                }}
              >
                Share on LinkedIn
              </a>
              <a
                href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(templateUrl ?? '')}&text=${encodeURIComponent(`I published my architecture "${published.name}" on NodeSpec`)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '6px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '6px',
                  border: `1px solid ${c.border}`, color: c.text, textDecoration: 'none',
                }}
              >
                Share on X
              </a>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 18px', fontSize: '13px', fontWeight: 500, borderRadius: '8px',
                  border: `1px solid ${c.border}`, backgroundColor: c.background,
                  color: c.text, cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ marginBottom: '14px' }}>
                <label style={labelStyle}>Template name</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  maxLength={120}
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: '14px' }}>
                <label style={labelStyle}>Description</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="What does this architecture do, and who is it for?"
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Category</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value as (typeof CATEGORIES)[number])}
                    style={{ ...inputStyle, cursor: 'pointer' }}
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Tags (comma-separated)</label>
                  <input
                    value={tagsText}
                    onChange={e => setTagsText(e.target.value)}
                    placeholder="react, stripe, auth"
                    style={inputStyle}
                  />
                </div>
              </div>
              <div style={{ marginBottom: '14px' }}>
                <label style={labelStyle}>Source repository (optional)</label>
                <input
                  value={repoUrl}
                  onChange={e => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/you/your-repo"
                  style={inputStyle}
                />
              </div>
              {foldedSpec && (
                <label style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  fontSize: '12.5px', color: c.text, cursor: 'pointer', marginBottom: '10px',
                }}>
                  <input
                    type="checkbox"
                    checked={includeSpec}
                    onChange={() => setIncludeSpec(v => !v)}
                    style={{ accentColor: c.primary }}
                  />
                  Include specification ({foldedSpec.requirements.length} requirement{foldedSpec.requirements.length === 1 ? '' : 's'} + vision)
                </label>
              )}
              <div style={{
                fontSize: '11.5px', color: c.textMuted, lineHeight: 1.5,
                padding: '10px 12px', borderRadius: '8px',
                backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
              }}>
                Artifact source code is never published — only your architecture,
                contracts, and file paths. Your template goes live immediately as a
                community listing you can update or delete any time.
              </div>
              {error && (
                <div style={{
                  marginTop: '10px', fontSize: '12px', color: '#dc2626', lineHeight: 1.45,
                }}>
                  {error}
                </div>
              )}
            </div>
            <div style={{
              padding: '12px 24px', borderTop: `1px solid ${c.border}`,
              display: 'flex', justifyContent: 'flex-end', gap: '8px',
            }}>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 18px', fontSize: '13px', fontWeight: 500, borderRadius: '8px',
                  border: `1px solid ${c.border}`, backgroundColor: c.background,
                  color: c.text, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSubmit()}
                disabled={submitting || loadingExisting}
                style={{
                  padding: '8px 18px', fontSize: '13px', fontWeight: 600, borderRadius: '8px',
                  border: 'none', backgroundColor: c.primary, color: '#ffffff',
                  cursor: submitting || loadingExisting ? 'wait' : 'pointer',
                  opacity: submitting || loadingExisting ? 0.7 : 1,
                }}
              >
                {submitting
                  ? 'Publishing…'
                  : existing
                    ? 'Publish update'
                    : 'Publish'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
