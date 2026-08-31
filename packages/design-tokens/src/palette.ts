/**
 * Raw color values — "Hướng 1A · Bình tĩnh & ấm" (locked design direction).
 * Extracted verbatim from the Claude Design handoff (docs/design/handoff/).
 * Do not consume raw values in components — use the semantic `tokens` map.
 */
export const palette = {
  // Warm neutrals / surfaces
  cream: '#FFFBF5',
  white: '#FFFFFF',
  sand: '#F4F0E8',
  paper: '#F7F7F5', // teacher surface (more neutral)

  // Teal (primary family)
  teal600: '#0E9384',
  teal700: '#0B6E62',
  teal800: '#08544B',
  tealTint: '#E7F5F3',
  tealMint: '#7FD1C4',
  tealDeep: '#3E6E68',

  // Ink / text
  ink900: '#14211E',
  ink700: '#3B4642',
  ink600: '#4B5563',
  ink500: '#5B6660',
  ink400: '#7A8580',
  ink300: '#9AA3A0',
  ink200: '#C7CFCB',

  // Warm borders / dividers
  border: '#EFE4D6',
  borderSoft: '#F1E8DC',
  dividerNeutral: '#DCE0E6',

  // Attention / amber (status, never used alone — always paired with text/icon)
  amber600: '#D97706',
  amber500: '#F59E0B',
  amberText: '#92600A',
  amberWarn: '#B45309',
  amberBody: '#6B5528',
  amberHeading: '#3F2D0C',
  amberBg: '#FFF4E4',
  amberBorder: '#F3DFC2',
  amberIconBg: '#F7E4C3',
  amberSoft: '#FFC46B',

  // Dark surfaces (scan camera, child challenge)
  night900: '#14211E',
  night800: '#22332F',

  // Child access / web sidebar accent chip
  childCode: '#3F2D0C',
} as const;

export type PaletteKey = keyof typeof palette;
