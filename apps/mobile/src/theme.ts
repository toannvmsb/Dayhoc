/**
 * DạyZi mobile theme.
 *
 * Screens follow **Hướng 1A · "Bình tĩnh & ấm"** — the locked visual direction
 * from `docs/design/handoff/00-three-directions.dc.html` (cream background,
 * teal primary, warm single-column card stack). Values below are sourced
 * directly from that mockup's swatches, not invented.
 *
 * This intentionally DIVERGES from `@copilot/design-tokens` (the cobalt→violet
 * "DạyZi brand" palette applied to the web shell in `fe1421f`) — per product
 * decision (2026-09-05), the mobile app keeps the **DạyZi brand identity**
 * (Be Vietnam Pro font, and the app icon/splash logo — see `app.config.ts`)
 * but its actual screens use Hướng 1A's colors, not the cobalt/violet ones.
 * Do not "fix" this file to match `@copilot/design-tokens` without checking —
 * the divergence is deliberate.
 */
export const theme = {
  color: {
    bg: '#FFFBF5', // cream — screen background
    surface: '#FFFFFF',
    surfaceRaised: '#F4F0E8', // warm cream-grey — tag pills, progress-bar track
    primary: '#0E9384', // teal
    primaryStrong: '#0B6E62', // dark teal — pressed state, CTA text on a teal card
    primaryTint: '#E3F5F2', // pale teal — "current step" chips, selected states
    violet: '#7A5AF8', // unchanged — BẢN DEV banner only, not part of the screen palette
    mint: '#34B575', // positive/mastery-progress fill — green, distinct from primary teal
    mintBg: '#DFF7E6', // "done" chips (e.g. gap lifecycle steps)
    mintText: '#1D7A4C',
    textHeading: '#14211E', // warm near-black
    textBody: '#5B6660', // warm dark grey-green
    textMuted: '#7A8580', // warm mid grey
    textFaint: '#9AA3A0', // warm faint grey — eyebrow labels
    border: '#EFE4D6', // warm cream border — cards
    attentionBg: '#FFF4E4', // "cần chú ý" amber-cream
    attentionBorder: '#F3DFC2',
    attentionText: '#6B5528', // amber-brown — attention-card body text, form errors
    attentionHeading: '#3F2D0C',
    danger: '#C0392B', // destructive actions only (irreversible delete) — kept apart
    // from the calm amber "attention" system so a real destructive button still
    // reads as more serious than a routine warning.
    night: '#111633', // unchanged — camera/scan dark overlay
    onDark: '#FFFFFF',
  },
  radius: { sm: 10, md: 14, lg: 18, pill: 999 },
  space: (n: number) => n * 4,
  font: {
    // Be Vietnam Pro (OFL, bundled via @expo-google-fonts) — kept as the DạyZi
    // brand typeface; Hướng 1A's own mockup uses Plus Jakarta Sans but the
    // product decision was to keep DạyZi's font here. Falls back to the system
    // font until `useFonts` resolves — see app/_layout.tsx.
    regular: 'BeVietnamPro_400Regular',
    medium: 'BeVietnamPro_500Medium',
    bold: 'BeVietnamPro_700Bold',
  },
} as const;

export type Theme = typeof theme;
