import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { visionSentences, visionSentenceId, resolveServes, servesOf } from '../ui/utils/vision-sentences.js';

// AA.1 (owner 2026-09-23): the vision splits into sentences with stable ids
// and every outcome cites the sentence or sentences it serves. The app and
// the server must agree on every id, so the app's module is the server's,
// byte for byte, from the first export on.

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');

describe('AA.1 · vision sentences, one rule in two places', () => {
  it('the app mirror is byte-identical to the server module from the first export on', () => {
    const pure = (s: string) => s.slice(s.indexOf('export interface VisionSentence'));
    const app = pure(read('src/ui/utils/vision-sentences.ts'));
    expect(app).toBe(pure(read('supabase/functions/_shared/vision-sentences.ts')));
    expect(app.length).toBeGreaterThan(1500);
  });

  it('splits, identifies and resolves the way the server does', () => {
    const s = visionSentences('# Shelfie\n\nShelfie helps bookshops sell online. Orders ship in two days!\n- Owners see stock.');
    expect(s.map((x) => x.text)).toEqual(['Shelfie helps bookshops sell online.', 'Orders ship in two days!', 'Owners see stock.']);
    expect(visionSentenceId('orders ship in **two** days')).toBe(s[1].id);
    expect(resolveServes([s[2].id, 'Refunds'], s)).toEqual({ served: [s[2]], unknown: ['Refunds'] });
    expect(servesOf({ serves: [{ id: s[0].id, text: s[0].text }] })).toEqual([s[0]]);
  });
});
