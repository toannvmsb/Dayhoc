import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tokens } from './tokens.js';

describe('design tokens', () => {
  it('exposes all four learning-mix dimensions with both surface variants', () => {
    for (const dim of ['school', 'gapRepair', 'advanced', 'thinking'] as const) {
      expect(tokens.learningMix[dim].onLight).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(tokens.learningMix[dim].onPrimary).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('keeps child CTA at least as tall as the parent CTA (child = larger targets)', () => {
    expect(tokens.hit.ctaHeightChild).toBeGreaterThanOrEqual(tokens.hit.ctaHeightParent);
  });

  it('meets a 44px minimum interactive target', () => {
    expect(tokens.hit.minTarget).toBeGreaterThanOrEqual(44);
    expect(tokens.hit.navItemHeight).toBeGreaterThanOrEqual(44);
  });

  it('CSS file defines a variable for every semantic color role used on web', () => {
    const cssPath = fileURLToPath(new URL('./tokens.css', import.meta.url));
    const css = readFileSync(cssPath, 'utf8');
    for (const v of [
      '--c-bg',
      '--c-primary',
      '--c-attention-bg',
      '--c-mix-school',
      '--c-mix-thinking',
      '--font-family',
      '--hit-cta',
    ]) {
      expect(css, `missing ${v}`).toContain(v);
    }
  });
});
