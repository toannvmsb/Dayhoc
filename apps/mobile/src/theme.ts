/**
 * DạyZi mobile theme.
 *
 * Values mirror `@copilot/design-tokens` (palette.ts / tokens.ts) — the web and
 * mobile share ONE brand. They are inlined here (not imported) so the mobile
 * bundle has zero runtime dependency on a workspace package; keep them in sync
 * with the design-tokens package when the brand changes.
 */
export const theme = {
  color: {
    bg: '#F7F8FC',
    surface: '#FFFFFF',
    surfaceRaised: '#EEF1F8',
    primary: '#3B5BFF',
    primaryStrong: '#2E45D9',
    primaryTint: '#EAEEFF',
    violet: '#7A5AF8',
    mint: '#12B886',
    mintBg: '#E5FBF3',
    mintText: '#0B6B50',
    textHeading: '#141A2E',
    textBody: '#48506B',
    textMuted: '#7B8299',
    textFaint: '#9AA1B4',
    border: '#E2E6F1',
    attentionBg: '#FFEEEB',
    attentionText: '#9A2C1E',
    attentionHeading: '#5C1E14',
    night: '#111633',
    onDark: '#FFFFFF',
  },
  radius: { sm: 10, md: 14, lg: 18, pill: 999 },
  space: (n: number) => n * 4,
  font: {
    // Be Vietnam Pro on the web; system default on mobile until the font is bundled.
    family: undefined as string | undefined,
  },
} as const;

export type Theme = typeof theme;
