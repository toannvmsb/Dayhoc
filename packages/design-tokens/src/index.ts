/**
 * @copilot/design-tokens — the locked "Hướng 1A · Bình tĩnh & ấm" system.
 *
 * Source of truth: docs/design/handoff/ (Claude Design export) + UI/UX Spec v1.0.
 * Web consumes `tokens.css` (CSS custom properties); React Native consumes the
 * `tokens` object directly. Keep both in sync — the CSS file is generated from
 * the same semantic names.
 */
export { palette } from './palette.js';
export type { PaletteKey } from './palette.js';
export { tokens } from './tokens.js';
export type { Tokens } from './tokens.js';
