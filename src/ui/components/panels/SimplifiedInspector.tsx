import { useState, useCallback } from 'react';
import type { Graph, Node, PatchOperation } from '@nodespec/core/types.js';
import { buildUpdateNodePatch } from '../../builders/patchBuilders.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { getNodeTypeById } from '@nodespec/core/node-types.js';
import type { MetadataFieldSchema } from '@nodespec/core/node-types.js';
import { DynamicMetadataForm } from './DynamicMetadataForm.js';
import { useCatalog } from '../../hooks/useCatalog.js';
import { deriveNodeNature, CUSTOM_NATURE } from '../../utils/node-nature.js';
import { ConnectionPointsEditor } from './inspector/ConnectionPointsEditor.js';
import { ConnectionDetails } from './inspector/ConnectionDetails.js';
import { resolveConfigChoice } from '@nodespec/core/config-choice.js';

// ─── Collapsible Section Header ─────────────────────────────────────────────

function InspectorSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { theme } = useTheme();
  const c = theme.colors;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '10px 16px',
          backgroundColor: c.backgroundSecondary,
          border: 'none',
          borderBottom: `1px solid ${c.border}`,
          color: c.text,
          fontSize: '11px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {title}
        <span style={{
          fontSize: '10px',
          color: c.textMuted,
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s ease',
        }}>
          &#9660;
        </span>
      </button>
      {open && children}
    </div>
  );
}

// ─── Setup Checklist Section ────────────────────────────────────────────────


interface SimplifiedInspectorProps {
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  graph: Graph;
  onPatchGenerated: (patch: PatchOperation) => void;
  onPatchesGenerated?: (patches: PatchOperation[]) => void;
}

// N8.6(B): content-only, always. The standalone fixed-position shell (own frame,
// own header incl. the 🔗 Connection line) was unreachable — every mount goes
// through NodeSidepane, which owns the frame and header and always passed
// `embedded`. The prop and the dead branch are gone with it.
export function SimplifiedInspector({
  selectedNodeId,
  selectedEdgeId,
  graph,
  onPatchGenerated,
  onPatchesGenerated,
}: SimplifiedInspectorProps) {
  const selectedNode = selectedNodeId ? graph.nodes[selectedNodeId] : null;
  const selectedEdge = selectedEdgeId ? graph.edges[selectedEdgeId] : null;

  if (!selectedNode && !selectedEdge) {
    return null;
  }

  return (
    <>
      {selectedNode && (
        <NodeDetails node={selectedNode} graph={graph} onPatchGenerated={onPatchGenerated} onPatchesGenerated={onPatchesGenerated} />
      )}
      {selectedEdge && <ConnectionDetails edge={selectedEdge} graph={graph} onPatchGenerated={onPatchGenerated} />}
    </>
  );
}

/** N8.4t: first source with at least one field. Precedence is technology → role →
 *  static node type, but an EMPTY object must not win — `??` treated `{}` as an answer
 *  and hid the role's fields behind an unenriched technology row. */
function firstPopulatedSchema(
  ...sources: Array<Record<string, unknown> | null | undefined>
): Record<string, MetadataFieldSchema> | null {
  for (const src of sources) {
    if (src && Object.keys(src).length > 0) return src as Record<string, MetadataFieldSchema>;
  }
  return null;
}

function NodeDetails({
  node,
  graph,
  onPatchGenerated,
  onPatchesGenerated,
}: {
  node: Node;
  graph: Graph;
  onPatchGenerated: (patch: PatchOperation) => void;
  onPatchesGenerated?: (patches: PatchOperation[]) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const catalogResolver = useCatalog();

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(node.label);
  const [editingRationale, setEditingRationale] = useState(false);
  const [rationaleValue, setRationaleValue] = useState(
    (node.metadata?.rationale as string) || ''
  );
  const nodeType = getNodeTypeById(node.type);


  const sectionStyles: React.CSSProperties = {
    padding: '16px',
    borderBottom: `1px solid ${c.border}`,
  };

  const labelStyles: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: c.textMuted,
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };

  const inputStyles: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: c.background,
    border: `1px solid ${c.border}`,
    borderRadius: '6px',
    color: c.text,
    fontSize: '13px',
    outline: 'none',
    fontFamily: 'inherit',
  };

  const textareaStyles: React.CSSProperties = {
    ...inputStyles,
    minHeight: '80px',
    resize: 'vertical' as const,
    fontFamily: 'inherit',
    lineHeight: '1.5',
  };

  const buttonStyles: React.CSSProperties = {
    padding: '8px 16px',
    backgroundColor: c.primary,
    border: 'none',
    borderRadius: '6px',
    color: 'white',
    fontSize: '13px',
    cursor: 'pointer',
    fontWeight: 500,
  };

  const handleSaveName = useCallback(() => {
    if (nameValue !== node.label) {
      const patch = buildUpdateNodePatch({
        nodeId: node.id,
        updates: { label: nameValue },
        actor: 'human',
        summary: `Rename to "${nameValue}"`,
      });
      onPatchGenerated(patch);
    }
    setEditingName(false);
  }, [nameValue, node, onPatchGenerated]);

  const handleSaveRationale = useCallback(() => {
    if (rationaleValue !== (node.metadata?.rationale || '')) {
      const patch = buildUpdateNodePatch({
        nodeId: node.id,
        updates: {
          metadata: {
            ...node.metadata,
            rationale: rationaleValue,
          },
        },
        actor: 'human',
        summary: 'Update rationale',
      });
      onPatchGenerated(patch);
    }
    setEditingRationale(false);
  }, [rationaleValue, node, onPatchGenerated]);

  return (
    <>
      {/* N5.5 (owner: "extremely simplify"): the Details body carries ONLY fields with a
          real backend destination — name (label: anchor+packets+MCP), rationale
          (packets+MCP), technology (everything), Configuration (metadata.config →
          packets+export+fingerprint, made live in this task), ports (anchor+MCP,
          collapsed). Cut per audit: description (dead), kind paragraph (display-only),
          ContainerMetadataEditor (dead), PlacementKindEditor (anchor-only; re-drag
          corrects placement), setup checklist / staleness / code-structure / library
          views (display-only or dead-to-AI). Files live in the Files tab. */}
      <InspectorSection title="Identity" defaultOpen={true}>
        <div style={sectionStyles}>
          <div style={labelStyles}>Name</div>
          {editingName ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="text"
                style={inputStyles}
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') {
                    setNameValue(node.label);
                    setEditingName(false);
                  }
                }}
                autoFocus
              />
              <button style={buttonStyles} onClick={handleSaveName}>
                Save
              </button>
            </div>
          ) : (
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: c.background,
                borderRadius: '6px',
                cursor: 'pointer',
                color: c.text,
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
              }}
              onClick={() => setEditingName(true)}
            >
              {/* M1c: the kind chip is GONE (NODE_REFERENCE §12.4). It showed raw ontology
                  jargon to a user already told the answer in plain language by the nature
                  line below — and it was the least complete of the three recognition
                  vocabularies, knowing 10 of 13 kinds, so every platform and managed
                  capability rendered a bare snake_case word in fallback grey. The nature
                  sentence + the Build/Connect/Host chip are the whole story. */}
              <span>{node.label}</span>
            </div>
          )}
        </div>

        <div style={sectionStyles}>
          <div style={labelStyles}>Rationale</div>
          {editingRationale ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <textarea
                style={textareaStyles}
                value={rationaleValue}
                onChange={(e) => setRationaleValue(e.target.value)}
                placeholder="Why does this component exist? What logic/responsibilities does it own?"
                autoFocus
                rows={4}
              />
              <button style={buttonStyles} onClick={handleSaveRationale}>
                Save
              </button>
            </div>
          ) : (
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: c.background,
                borderRadius: '6px',
                cursor: 'pointer',
                color: rationaleValue ? c.text : c.textMuted,
                fontSize: '13px',
                fontStyle: rationaleValue ? 'normal' : 'italic',
                lineHeight: '1.5',
                minHeight: '40px',
              }}
              onClick={() => setEditingRationale(true)}
            >
              {rationaleValue || 'Click to add rationale (goes into the AI task packet)'}
            </div>
          )}
        </div>
      </InspectorSection>

      <InspectorSection title="Technology" defaultOpen={true}>
        {/* N8.1: the technology REBIND dropdown is GONE (owner: "the Node inspector
            should not have a dropdown where the user can configure the Technology —
            this is not consistent across all nodes"). Technology is a creation-time
            choice (search/drop pickers); the AI patch lane can still rebind. Here the
            binding renders read-only with the nature line. */}
        {(() => {
          if (!catalogResolver) return null;
          const roleForTech = catalogResolver.getRole(node.type);
          if (!roleForTech || roleForTech.isContainer) return null;
          const boundTech = node.technology ? catalogResolver.getTechnology(node.technology) : null;
          const customName = typeof node.metadata?.customTechnology === 'string' ? node.metadata.customTechnology : null;
          if (!boundTech && !customName) return null;
          return (
            <div style={sectionStyles}>
              <div style={labelStyles}>Technology</div>
              <div style={{ fontSize: '12px', color: c.text }}>
                {boundTech ? (boundTech.displayName || boundTech.name) : `${customName} (custom)`}
              </div>
              <div style={{ marginTop: '6px', fontSize: '11px', color: c.textSecondary }}>
                {customName && !node.technology
                  ? CUSTOM_NATURE.line
                  : deriveNodeNature(roleForTech, boundTech).line}
              </div>
            </div>
          );
        })()}

        {/* N5: ONE schema-driven Configuration form. N5.5 made metadata.config REAL —
            it reaches task packets ("## Configuration"), the context export, and the
            config fingerprint. N8.1b (owner): configuration is a per-node CHOICE —
            "AI decides" (delegated; the packet says so) or "I'll specify" (the
            technology's CURATED fields render — never a generic free-text catch-all).
            Schema-less technologies say so honestly; curated fields arrive technology
            by technology through the N8 enrichment chunks. */}
        {(() => {
          if (!catalogResolver) return null;
          const boundTech = node.technology ? catalogResolver.getTechnology(node.technology) : null;
          const roleRow = catalogResolver.getRole(node.type);
          // N8.4t (owner bench 2026-07-27: "AWS project 'I'll specify' still doesn't
          // show anything"). This used `??`, which only falls through on null/undefined —
          // and an unenriched technology row carries `{}`, not null. So a node bound to a
          // technology with no curated fields showed "No curated fields yet" even when its
          // ROLE had a full schema, silently shadowing it. That is every platform
          // container carrying `technology: 'aws' | 'azure' | 'gcp'` (those rows are `{}`)
          // and, in general, any of the 131 empty-schema technologies sitting on a
          // schema-bearing role. An empty schema means "this source has nothing to add",
          // never "stop looking".
          const schema = firstPopulatedSchema(
            boundTech?.metadataSchema,
            roleRow?.metadataSchema,
            nodeType?.metadataSchema,
          );
          const hasSchema = !!schema;
          const values = (node.metadata?.config as Record<string, unknown>) ?? {};
          // 'ai' (default) = delegated; 'manual' = the user specifies. Persisted OUTSIDE
          // config so it never renders as a packet config line itself.
          // Owner bug 2026-07-30 ("can't click AI Decides after specifying"): this read
          // `configSource === 'manual' || hasValues`, so a single config value PINNED the
          // toggle to manual — the click wrote configSource:'ai' and the next render
          // recomputed straight back. resolveConfigChoice makes the explicit choice win
          // (values stay dormant and return if the user switches back); the packet and
          // context exporters read the SAME rule, so no surface can contradict another.
          const choice = resolveConfigChoice(node.metadata as Record<string, unknown> | undefined);
          const source = choice === 'user-specified' ? 'manual' : 'ai';
          const setSource = (next: 'ai' | 'manual') => {
            if (next === source) return;
            onPatchGenerated(buildUpdateNodePatch({
              nodeId: node.id,
              updates: { metadata: { ...node.metadata, configSource: next } },
              actor: 'human',
              summary: next === 'ai' ? 'Delegate configuration to AI' : 'Configure manually',
            }));
          };
          const modeButton = (mode: 'ai' | 'manual', text: string) => (
            <button
              onClick={() => setSource(mode)}
              style={{
                flex: 1, padding: '4px 8px', fontSize: '11px', cursor: 'pointer',
                borderRadius: '5px', border: `1px solid ${source === mode ? c.primary : c.border}`,
                background: source === mode ? `${c.primary}22` : 'transparent',
                color: source === mode ? c.text : c.textSecondary,
              }}
            >
              {text}
            </button>
          );
          return (
            <div style={sectionStyles}>
              <div style={labelStyles}>Configuration</div>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                {modeButton('ai', 'AI decides')}
                {modeButton('manual', 'I’ll specify')}
              </div>
              {source === 'ai' ? (
                <div style={{ fontSize: '11px', color: c.textSecondary }}>
                  Delegated — the build instructions tell the AI to choose sensible
                  defaults for {boundTech ? (boundTech.displayName || boundTech.name) : 'this component'} and record them.
                </div>
              ) : hasSchema ? (
                <DynamicMetadataForm
                  schema={schema as Record<string, MetadataFieldSchema>}
                  values={values}
                  onUpdate={(key, value) => {
                    onPatchGenerated(buildUpdateNodePatch({
                      nodeId: node.id,
                      updates: { metadata: { ...node.metadata, config: { ...values, [key]: value } } },
                      actor: 'human',
                      summary: `Update ${key}`,
                    }));
                  }}
                />
              ) : (
                <div style={{ fontSize: '11px', color: c.textSecondary }}>
                  No curated fields for this technology yet — the build instructions
                  will ask the AI to confirm configuration with you. Curated inputs
                  arrive with catalog enrichment.
                </div>
              )}
            </div>
          );
        })()}
      </InspectorSection>

      <InspectorSection title="Connections" defaultOpen={false}>
        <ConnectionPointsEditor node={node} graph={graph} onPatchGenerated={onPatchGenerated} onPatchesGenerated={onPatchesGenerated} />
      </InspectorSection>
    </>
  );
}
