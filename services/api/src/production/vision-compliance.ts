import { DataMinimizationError, minimizeForProvider, type ProviderCompliance } from '@copilot/ai';

/**
 * What the privacy architecture (§5, §10) requires before a child's schoolwork photo leaves for a
 * model provider. The photo is the only child data in the request: no name, school, e-mail or child id
 * is sent (the request body is built from the image, a fixed instruction, the grade and a skill-id list).
 *
 * `dpaStatus` is deliberately 'pending' — no data-processing agreement has been signed with this
 * provider. That is a legal fact for the owner to update when it changes, not something code may assume.
 */
export const OPENAI_VISION_COMPLIANCE: ProviderCompliance = {
  provider: 'openai',
  processingRegion: 'us',
  crossBorder: true,
  dataCategoriesAllowed: ['raw_schoolwork'],
  providerRetention: 'API requests are retained by the provider for abuse monitoring (up to 30 days) and are not used for training by default — confirm in the DPA',
  trainingAllowed: false,
  dpaStatus: 'pending',
};

export function visionCompliance(provider: string): ProviderCompliance | null {
  return provider === 'openai' ? OPENAI_VISION_COMPLIANCE : null;
}

/**
 * Throws when sending this child's photo to `provider` would break the minimisation rules:
 * unknown provider (no compliance record), training allowed, or a category it may not receive.
 * Returns the opaque child ref the call is recorded under.
 */
export function assertVisionProviderCompliant(provider: string, childId: string): string {
  const compliance = visionCompliance(provider);
  if (!compliance) throw new DataMinimizationError(`no compliance record for vision provider "${provider}"`);
  return minimizeForProvider({ payload: { purpose: 'document_photo_reading' }, categories: ['raw_schoolwork'], provider: compliance, childId }).childRef;
}
