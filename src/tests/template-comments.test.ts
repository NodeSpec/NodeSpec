import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Template comments (hosted edition). Source-text contracts in the house
// style: the surface mounts OUTSIDE TemplateDetail (whose own contract
// tests must stay untouched), writes go straight through PostgREST with
// RLS as the gate, and attribution resolves through user_profiles with a
// generic fallback.
describe('Template comments surface', () => {
  const comments = readFileSync(
    resolve(__dirname, '../ui/components/templates/TemplateComments.tsx'),
    'utf-8'
  );
  const detailPage = readFileSync(
    resolve(__dirname, '../ui/components/templates/TemplateDetailPage.tsx'),
    'utf-8'
  );
  const detail = readFileSync(
    resolve(__dirname, '../ui/components/templates/TemplateDetail.tsx'),
    'utf-8'
  );

  it('mounts in TemplateDetailPage gated by hosted edition, not inside TemplateDetail', () => {
    expect(detailPage).toContain('<TemplateComments');
    expect(detailPage).toContain('isHostedEdition && (');
    expect(detail).not.toContain('TemplateComments');
  });

  it('paginates newest-first with a count', () => {
    expect(comments).toContain(".order('created_at', { ascending: false })");
    expect(comments).toContain('.range(offset, offset + PAGE_SIZE - 1)');
    expect(comments).toContain("count: 'exact'");
  });

  it('writes through PostgREST against template_comments (RLS is the gate)', () => {
    expect(comments).toContain("from('template_comments')");
    expect(comments).toContain('.insert({ template_id: templateId, user_id: user.id, body })');
    expect(comments).toContain('.delete()');
    expect(comments).not.toContain('functions.invoke');
  });

  it('mirrors the 4000-char body cap and derives edited from timestamps', () => {
    expect(comments).toContain('MAX_BODY = 4000');
    expect(comments).toContain('comment.updated_at > comment.created_at');
  });

  it('attributes via profiles with the anonymous fallback and signed-out CTA', () => {
    expect(comments).toContain('getProfilesByUserIds');
    expect(comments).toContain("'Community member'");
    expect(comments).toContain("navigate('/?signup=templates')");
  });
});
