import { palette } from './palette.js';

/**
 * Semantic design tokens. Components reference THESE, never raw palette values.
 * Same object is consumed by web (via CSS vars in tokens.css) and React Native.
 *
 * UI/UX Spec invariants encoded here:
 *  - status is never conveyed by color alone (each status token pairs bg + text + a non-color cue in components)
 *  - one primary action per screen → a single `action.primary` emphasis token
 *  - Parent calm / Child larger-type / Teacher neutral → three surface themes
 */
export const tokens = {
  color: {
    // App surfaces
    bg: palette.cream,
    surface: palette.white,
    surfaceSubtle: palette.sand,
    surfaceTeacher: palette.paper,
    surfaceInverse: palette.night900,
    surfaceInverseAlt: palette.night800,

    // Text
    textHeading: palette.ink900,
    textBody: palette.ink600,
    textBodyStrong: palette.ink700,
    textLabel: palette.ink500,
    textMuted: palette.ink400,
    textFaint: palette.ink300,
    textDisabled: palette.ink200,
    textOnPrimary: palette.white,
    textOnInverse: palette.white,

    // Primary (teal)
    primary: palette.teal600,
    primaryStrong: palette.teal700,
    primaryHover: palette.teal800,
    primaryTint: palette.tealTint,
    onPrimaryTint: palette.teal700,

    // Borders
    border: palette.border,
    borderSoft: palette.borderSoft,
    divider: palette.dividerNeutral,
    focusRing: palette.teal600,

    // Status — attention / needs work (amber). Pair bg+text+icon in components.
    attentionBg: palette.amberBg,
    attentionBorder: palette.amberBorder,
    attentionText: palette.amberText,
    attentionHeading: palette.amberHeading,
    attentionBody: palette.amberBody,
    attentionDot: palette.amber600,
    attentionIconBg: palette.amberIconBg,

    // Status — on/above target — Mint (progress)
    positiveText: palette.mintText,
    positiveBar: palette.mint600,
    positiveBg: palette.mintBg,

    // Status — unstable / below target (amber bar)
    unstableText: palette.amberWarn,
    unstableBar: palette.amber500,
  },

  /**
   * Learning-mix palette — the 4 dimensions of the Today Plan / Weekly allocation bar.
   * Order matches domain `LEARNING_MIX_DIMENSIONS`: school, gapRepair, advanced, thinking.
   * `onLight` for bars on a light card; `onPrimary` for bars sitting on the teal hero card.
   */
  learningMix: {
    school: { onLight: palette.teal600, onPrimary: palette.white }, // cobalt
    gapRepair: { onLight: palette.amber500, onPrimary: palette.amberSoft }, // coral
    advanced: { onLight: palette.mint500, onPrimary: palette.tealMint }, // mint
    thinking: { onLight: palette.tealDeep, onPrimary: palette.tealDeep }, // violet
  },

  font: {
    family:
      "'Be Vietnam Pro', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    weight: { regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800 },
    // px. `child*` sizes are the larger child-app ramp (Child = bigger type, one task per view).
    size: {
      overline: 11,
      caption: 12.5,
      bodySm: 13.5,
      body: 15,
      bodyLg: 16,
      cardTitle: 17,
      childBody: 15.5,
      childTitle: 17,
      sectionTitle: 19,
      question: 21,
      screenTitle: 25,
      hero: 27,
      heroLg: 32,
    },
    lineHeight: { tight: 1.2, heading: 1.35, snug: 1.45, body: 1.55, relaxed: 1.6 },
    letterSpacing: { heading: '-0.02em', headingSnug: '-0.01em', overline: '0.1em' },
  },

  // 4px base scale.
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, '2xl': 24, '3xl': 32, '4xl': 44 },

  radius: {
    chip: 8,
    input: 14,
    control: 16,
    card: 20,
    cardLg: 24,
    sheet: 28,
    pill: 999,
  },

  // Screen gutters differ by platform per UI/UX Spec §18.
  layout: {
    screenPadMobile: 20,
    screenPadWeb: 32,
    webRailWidth: 248,
    contentMaxWidth: 1200,
    mobileFrame: 390,
  },

  elevation: {
    // 1A is border-led; shadows are reserved for lifted surfaces.
    card: '0 2px 10px rgba(23, 37, 84, 0.05)',
    sheet: '0 -12px 40px rgba(20, 33, 30, 0.14)',
    fab: '0 8px 18px rgba(14, 147, 132, 0.4)',
    frame: '0 24px 60px rgba(17, 24, 39, 0.16)',
  },

  // Minimum interactive sizes (accessibility — UI/UX Spec §2, §23).
  hit: {
    ctaHeightParent: 54,
    ctaHeightChild: 58,
    inputHeight: 52,
    navItemHeight: 44,
    minTarget: 44,
  },

  motion: {
    fast: '120ms',
    base: '200ms',
    slow: '320ms',
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
} as const;

export type Tokens = typeof tokens;
