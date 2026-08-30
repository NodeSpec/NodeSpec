import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/*
  OSS Community landing section (owner design, 2026-08-26): the hosted
  marketing page gains a public-repository section between the product tour
  and the technology catalog. These pins hold the placement, the single CTA,
  and the license line.
*/

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf-8');
const section = read('../ui/components/auth/OssCommunitySection.tsx');
const landing = read('../ui/components/auth/AuthLandingPage.tsx');

describe('OssCommunitySection', () => {
  it('renders under the product tour and above the technology catalog, inside the hosted gate', () => {
    const gatePos = landing.indexOf('{isHostedEdition && (');
    const tourPos = landing.indexOf('<ProductTourSection />');
    const ossPos = landing.indexOf('<OssCommunitySection />');
    const catalogPos = landing.indexOf('<TechEcosystemSection />');
    expect(gatePos).toBeGreaterThan(-1);
    expect(tourPos).toBeGreaterThan(gatePos);
    expect(ossPos).toBeGreaterThan(tourPos);
    expect(catalogPos).toBeGreaterThan(ossPos);
  });

  it('the single CTA is the public repository, opened in a new tab', () => {
    expect(section).toContain("const REPO_URL = 'https://github.com/NodeSpec/NodeSpec'");
    expect(section).toContain('href={REPO_URL}');
    expect(section).toContain('target="_blank"');
    expect(section).toContain('rel="noopener noreferrer"');
    expect(section).toContain('Browse the repository on GitHub');
  });

  it('carries the owner copy: heading, tagline, and the Apache license line', () => {
    expect(section).toContain('NodeSpec Community OSS');
    expect(section).toContain('Connect. Modify. Contribute.');
    expect(section).toContain('Licensed under the Apache License 2.0');
    expect(section).toContain('Issues and pull requests welcome');
  });

  it('uses the shared BlueprintGrid backdrop like the neighboring sections', () => {
    expect(section).toContain('<BlueprintGrid variant="dark" density="sparse" showNodes={false} />');
  });

  it('has mobile rules in the landing media block', () => {
    const css = read('../index.css');
    const mobileBlock = css.slice(css.indexOf('@media (max-width: 768px)'));
    for (const cls of ['.oss-community', '.oss-content', '.oss-cta-plate', '.oss-cta-arrow']) {
      expect(mobileBlock).toContain(cls);
    }
  });
});
