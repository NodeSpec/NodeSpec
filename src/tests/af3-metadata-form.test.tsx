// @vitest-environment jsdom
// AF.3 (owner 2026-09-28): the device hosts and Desktop Application ask with choices now,
// but nodes made before kept what people typed into the old free-text boxes, and the
// packet carries it. The form shows a stored value as it is stored: one that is not an
// option is its own choice until the person picks another, and a multiselect stored as
// one string reads as its ticks. The schemas below are the ones migration 20260928130000
// writes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '../ui/theme/ThemeContext.js';
import { DynamicMetadataForm } from '../ui/components/panels/DynamicMetadataForm.js';
import type { MetadataFieldSchema } from '@nodespec/core/node-types.js';

const DESKTOP_DEVICE: Record<string, MetadataFieldSchema> = {
  platform: { type: 'enum', label: 'Platform', default: 'cross-platform', options: ['macos', 'windows', 'linux', 'cross-platform'], description: 'The operating system the device runs' },
};
const DESKTOP_APP: Record<string, MetadataFieldSchema> = {
  platforms: { type: 'multiselect', label: 'Target platforms', options: ['windows', 'macos', 'linux'], description: 'The operating systems the app is built and shipped for' },
};

function form(schema: Record<string, MetadataFieldSchema>, values: Record<string, unknown>) {
  const onUpdate = vi.fn();
  const view = render(<ThemeProvider readOnly defaultMode="light"><DynamicMetadataForm schema={schema} values={values} onUpdate={onUpdate} /></ThemeProvider>);
  return { ...view, onUpdate };
}
const ticks = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('label')).map((l) => [l.textContent, (l.querySelector('input') as HTMLInputElement).checked]);

afterEach(cleanup);

describe('AF.3 an enum shows what the node stored', () => {
  it('a value typed before the field had options stays shown, unchanged, until the person picks another', () => {
    const { container, onUpdate } = form(DESKTOP_DEVICE, { platform: 'Windows 11' });
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('Windows 11');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['macos', 'windows', 'linux', 'cross-platform', 'Windows 11']);
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: 'windows' } });
    expect(onUpdate).toHaveBeenCalledWith('platform', 'windows');
  });

  it('a stored option, or nothing stored, adds no choice of its own', () => {
    const stored = form(DESKTOP_DEVICE, { platform: 'linux' }).container.querySelector('select') as HTMLSelectElement;
    expect([stored.value, stored.options.length]).toEqual(['linux', 4]);
    cleanup();
    const fresh = form(DESKTOP_DEVICE, {}).container.querySelector('select') as HTMLSelectElement;
    expect([fresh.value, fresh.options.length]).toEqual(['cross-platform', 4]);
  });
});

describe('AF.3 a multiselect shows what the node stored', () => {
  it('a comma-separated string from the old text box reads as its ticks, and a new tick saves the list', () => {
    const { container, onUpdate } = form(DESKTOP_APP, { platforms: 'windows, macos' });
    expect(ticks(container)).toEqual([['windows', true], ['macos', true], ['linux', false]]);
    fireEvent.click(container.querySelectorAll('input')[2]);
    expect(onUpdate).toHaveBeenCalledWith('platforms', ['windows', 'macos', 'linux']);
  });

  it('a stored item that is not an option shows ticked, and unticking it is the person\'s choice', () => {
    const { container, onUpdate } = form(DESKTOP_APP, { platforms: ['windows', 'ios'] });
    expect(ticks(container)).toEqual([['windows', true], ['macos', false], ['linux', false], ['ios', true]]);
    fireEvent.click(container.querySelectorAll('input')[3]);
    expect(onUpdate).toHaveBeenCalledWith('platforms', ['windows']);
  });

  it('nothing stored ticks nothing (a multiselect has no default)', () => {
    expect(ticks(form(DESKTOP_APP, {}).container)).toEqual([['windows', false], ['macos', false], ['linux', false]]);
  });
});
