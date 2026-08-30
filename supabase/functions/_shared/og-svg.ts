// 1200×630 social share card for a marketplace template (og:image).
//
// Pure SVG string builder — no I/O, no wasm — so the Deno tests can pin the
// output shape. The caller (og-image function) supplies node icons as data
// URIs; external hrefs are refused here because resvg does not fetch the
// network and a crawler-served image must be self-contained.
import {
  computeOgPreviewLayout,
  resolveAbsolutePositions,
  toLayoutNodes,
  ICON_W,
  ICON_H,
  type OgLayoutEdge,
} from "./og-preview-layout.ts";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const ACCENT = "#8B8FE6";
const CONTENT = { x: 60, y: 168, width: 1080, height: 380 };
const MAX_SCALE = 1.5;
const MAX_LABEL = 14;

export interface OgSvgNode {
  id: string;
  label: string;
  parentId?: string;
  /** data:image/...;base64 URI only; anything else renders as a letter tile. */
  iconDataUri?: string;
}

export interface OgSvgInput {
  name: string;
  authorLabel?: string;
  nodeCount: number;
  edgeCount: number;
  nodes: OgSvgNode[];
  edges: OgLayoutEdge[];
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function isSafeDataUri(uri: string | undefined): uri is string {
  return typeof uri === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(uri);
}

export function buildTemplateOgSvg(input: OgSvgInput): string {
  const layoutNodes = toLayoutNodes(input.nodes);
  const layout = computeOgPreviewLayout(layoutNodes, input.edges);
  const absolute = resolveAbsolutePositions(layoutNodes, layout);
  const sizeOf = new Map(layout.sizes.map((s) => [s.id, s]));
  const nodeById = new Map(input.nodes.map((n) => [n.id, n]));
  const containers = layoutNodes.filter((n) => n.isContainer);
  const leaves = layoutNodes.filter((n) => !n.isContainer);

  // Bounding box of everything drawn (containers by size, leaves by tile).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of layoutNodes) {
    const pos = absolute.get(n.id);
    if (!pos) continue;
    const size = sizeOf.get(n.id);
    const w = n.isContainer ? (size?.width ?? 300) : ICON_W;
    const h = n.isContainer ? (size?.height ?? 250) : ICON_H + 22; // label strip
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + w);
    maxY = Math.max(maxY, pos.y + h);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }

  const boundsW = Math.max(maxX - minX, 1);
  const boundsH = Math.max(maxY - minY, 1);
  const scale = Math.min(CONTENT.width / boundsW, CONTENT.height / boundsH, MAX_SCALE);
  const offsetX = CONTENT.x + (CONTENT.width - boundsW * scale) / 2 - minX * scale;
  const offsetY = CONTENT.y + (CONTENT.height - boundsH * scale) / 2 - minY * scale;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`
  );
  parts.push(
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#f8f9fc"/><stop offset="1" stop-color="#eef0fa"/>` +
      `</linearGradient></defs>`
  );
  parts.push(`<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#bg)"/>`);

  // Header: template name + facts line.
  const title = escapeXml(truncate(input.name, 42));
  parts.push(
    `<text x="60" y="88" font-family="Inter" font-weight="600" font-size="46" fill="#1f2937">${title}</text>`
  );
  const facts = [
    `${input.nodeCount} node${input.nodeCount === 1 ? "" : "s"}`,
    `${input.edgeCount} edge${input.edgeCount === 1 ? "" : "s"}`,
    ...(input.authorLabel ? [`by ${input.authorLabel}`] : []),
  ].join("  ·  ");
  parts.push(
    `<text x="60" y="126" font-family="Inter" font-size="22" fill="#6b7280">${escapeXml(truncate(facts, 80))}</text>`
  );

  // Wordmark bottom-right.
  parts.push(
    `<text x="${OG_WIDTH - 60}" y="${OG_HEIGHT - 42}" text-anchor="end" font-family="Inter" font-weight="600" font-size="26" fill="${ACCENT}">NodeSpec</text>`
  );

  const px = (n: number) => Math.round(n * 100) / 100;
  const tx = (x: number) => px(x * scale + offsetX);
  const ty = (y: number) => px(y * scale + offsetY);

  // Containers first (background layer), outermost first so nesting stacks.
  const depthOf = (id: string, depth = 0): number => {
    const parent = nodeById.get(id)?.parentId;
    return parent && depth < 32 ? depthOf(parent, depth + 1) : depth;
  };
  const sortedContainers = [...containers].sort((a, b) => depthOf(a.id) - depthOf(b.id));
  for (const container of sortedContainers) {
    const pos = absolute.get(container.id);
    const size = sizeOf.get(container.id);
    if (!pos || !size) continue;
    const label = escapeXml(truncate(nodeById.get(container.id)?.label ?? "", 24));
    parts.push(
      `<rect x="${tx(pos.x)}" y="${ty(pos.y)}" width="${px(size.width * scale)}" height="${px(size.height * scale)}" rx="${px(12 * scale)}" fill="rgba(139,143,230,0.06)" stroke="rgba(139,143,230,0.45)" stroke-width="1.5"/>`
    );
    if (label) {
      parts.push(
        `<text x="${tx(pos.x + 14)}" y="${ty(pos.y + 24)}" font-family="Inter" font-weight="600" font-size="${px(Math.max(13 * scale, 11))}" fill="#4b5563">${label}</text>`
      );
    }
  }

  // Edges between leaf centers (drawn under the tiles).
  const centerOf = (id: string): { x: number; y: number } | null => {
    const pos = absolute.get(id);
    if (!pos) return null;
    return { x: tx(pos.x + ICON_W / 2), y: ty(pos.y + ICON_H / 2) };
  };
  const leafIds = new Set(leaves.map((n) => n.id));
  for (const edge of input.edges) {
    if (!leafIds.has(edge.source) || !leafIds.has(edge.target)) continue;
    const a = centerOf(edge.source);
    const b = centerOf(edge.target);
    if (!a || !b) continue;
    parts.push(
      `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="rgba(139,143,230,0.55)" stroke-width="1.5"/>`
    );
  }

  // Leaf tiles: icon data URI when safe, letter tile otherwise; label below.
  for (const leaf of leaves) {
    const pos = absolute.get(leaf.id);
    if (!pos) continue;
    const node = nodeById.get(leaf.id);
    const x = tx(pos.x);
    const y = ty(pos.y);
    const w = px(ICON_W * scale);
    const h = px(ICON_H * scale);
    if (isSafeDataUri(node?.iconDataUri)) {
      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${px(8 * scale)}" fill="#ffffff" stroke="rgba(139,143,230,0.3)"/>`
      );
      parts.push(
        `<image x="${px(x + w * 0.12)}" y="${px(y + h * 0.12)}" width="${px(w * 0.76)}" height="${px(h * 0.76)}" href="${node!.iconDataUri}"/>`
      );
    } else {
      const letter = escapeXml((node?.label ?? "?").charAt(0).toUpperCase());
      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${px(8 * scale)}" fill="rgba(139,143,230,0.14)" stroke="rgba(139,143,230,0.4)"/>`
      );
      parts.push(
        `<text x="${px(x + w / 2)}" y="${px(y + h / 2 + 6 * scale)}" text-anchor="middle" font-family="Inter" font-weight="600" font-size="${px(18 * scale)}" fill="${ACCENT}">${letter}</text>`
      );
    }
    const label = escapeXml(truncate(node?.label ?? "", MAX_LABEL));
    if (label) {
      parts.push(
        `<text x="${px(x + w / 2)}" y="${px(y + h + 14 * scale)}" text-anchor="middle" font-family="Inter" font-size="${px(Math.max(11 * scale, 9))}" fill="#4b5563">${label}</text>`
      );
    }
  }

  parts.push("</svg>");
  return parts.join("");
}
