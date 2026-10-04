// Classification outside the Government build (audit, owner 2026-09-27):
// laid over the real component by scripts/ship1/lay-government-stubs.mjs in
// every other build. Same exports; no mark line is drawn, and no item
// carries a mark for the chip style to dress.

export const markChipBase: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '11px', fontWeight: 700, borderRadius: '3px', padding: '0 4px', lineHeight: '14px', letterSpacing: '.03em' };

export function MarkLine(_props: {
  mark: string | null;
  canClassify: boolean;
  onCommit: (mark: string | null) => void;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  return null;
}
