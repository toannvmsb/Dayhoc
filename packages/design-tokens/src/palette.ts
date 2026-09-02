/**
 * Raw color values — **DạyZi brand** (2027 product direction).
 *
 * Direction: modern · friendly · intelligent · young-parent · warm-but-not-childish
 * · premium enough for a paid subscription. Electric/Cobalt Blue → Violet, with a
 * Coral accent and a Mint progress colour. Vietnamese-first UI. Avoids generic-LMS
 * / school-admin / graduation-cap clichés.
 *
 * The semantic key names are kept stable (`teal*` = the primary blue→violet ramp,
 * `amber*` = the coral status family, `cream/sand` = cool off-white surfaces) so
 * components keep referencing the `tokens` map, never these raw values.
 */
export const palette = {
  // Cool neutrals / surfaces
  cream: '#F7F8FC', // app background — a cool near-white with a hint of blue
  white: '#FFFFFF',
  sand: '#EEF1F8', // subtle raised surface
  paper: '#F4F5F9', // teacher surface (a touch more neutral)

  // Primary family — Electric/Cobalt Blue → Violet
  teal600: '#3B5BFF', // primary — electric cobalt
  teal700: '#2E45D9', // primary strong
  teal800: '#5A3FE0', // primary hover — leans violet
  tealTint: '#EAEEFF', // primary tint surface
  tealMint: '#5FE3C0', // mint — "advanced" learning-mix + progress
  tealDeep: '#7A5AF8', // violet — "thinking" learning-mix

  // Ink / text — cool slate
  ink900: '#141A2E',
  ink700: '#333B52',
  ink600: '#48506B',
  ink500: '#5A6178',
  ink400: '#7B8299',
  ink300: '#9AA1B4',
  ink200: '#C9CDDA',

  // Borders / dividers
  border: '#E2E6F1',
  borderSoft: '#EAEDF6',
  dividerNeutral: '#DDE1EC',

  // Status — attention / needs work — Coral (status only, never used alone)
  amber600: '#F5533D',
  amber500: '#FF6B57',
  amberText: '#9A2C1E',
  amberWarn: '#B23A28',
  amberBody: '#7A2E22',
  amberHeading: '#5C1E14',
  amberBg: '#FFEEEB',
  amberBorder: '#FBD8D1',
  amberIconBg: '#FCDDD6',
  amberSoft: '#FF9E8E',

  // Positive / progress — Mint
  mint600: '#12B886',
  mint500: '#2ED3A0',
  mintBg: '#E5FBF3',
  mintText: '#0B6B50',

  // Dark surfaces (scan camera, child challenge) — deep indigo, not black
  night900: '#111633',
  night800: '#1D2450',

  // Child access / web sidebar accent chip
  childCode: '#2E45D9',
} as const;

export type PaletteKey = keyof typeof palette;
