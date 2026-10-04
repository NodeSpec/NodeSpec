// AA.3 with AA.5 (owner 2026-09-23), app side: on an exploded node the box's
// lease covers its parts. A person's edit to a part is refused while someone
// else holds the box's node lease; work held in the box does not lock its
// parts, and the holder's own box never locks them.
import { describe, expect, it } from 'vitest';
import { leasedEditRefusal, type NodeLease } from '../ui/components/ideation/node-leases.js';

const BOX = '00000000-0000-4000-8000-00000000000b';
const PART = '00000000-0000-4000-8000-000000000001';
const labels: Record<string, string> = { [BOX]: 'Checkout API', [PART]: 'Routes' };
const edit = [{ type: 'update_node', payload: { id: PART, changes: { label: 'Handlers' } } }];
const boxOf = (id: string) => (id === PART ? BOX : null);
const lease = (over: Partial<NodeLease>): Map<string, NodeLease> =>
  new Map([[BOX, { nodeId: BOX, holder: 'claude · lead', level: 'node', since: new Date().toISOString(), count: 1, mine: false, ...over }]]);

describe('AA.3 a box\'s lease covers its parts, in the app', () => {
  it('refuses an edit to a part while someone else holds the box', () => {
    const refusal = leasedEditRefusal(edit, lease({}), { boxOf, labelOf: (id) => labels[id] });
    expect(refusal).toContain('Routes is a part of Checkout API, which is leased by claude · lead');
    expect(refusal).toContain("A box's lease covers its parts");
  });

  it('work held in the box, or the viewer\'s own box lease, does not lock its parts', () => {
    expect(leasedEditRefusal(edit, lease({ level: 'work' }), { boxOf })).toBeNull();
    expect(leasedEditRefusal(edit, lease({ mine: true }), { boxOf })).toBeNull();
    expect(leasedEditRefusal(edit, lease({}), {})).toBeNull();
  });

  it('moving a part is layout and passes', () => {
    const move = [{ type: 'update_node', payload: { id: PART, changes: { position: { x: 1, y: 2 } } } }];
    expect(leasedEditRefusal(move, lease({}), { boxOf })).toBeNull();
  });
});
