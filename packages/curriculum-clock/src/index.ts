/**
 * @copilot/curriculum-clock — CurriculumClockService (Pricing v1.1 §2).
 *
 * Estimates the current SGK lesson from the academic calendar so the product
 * works with zero parent/teacher input. Deterministic; output is always
 * `ESTIMATED` confidence, discounted by the LearningContextResolver.
 */
export * from './clock.js';

import type { ExpectedLearningContext } from '@copilot/domain';
import type { ExpectedContext } from './clock.js';

/** Map the clock's estimate onto the domain `ExpectedLearningContext` shape. */
export function toExpectedLearningContext(ctx: ExpectedContext): ExpectedLearningContext {
  return {
    curriculum: ctx.curriculum,
    chapterId: ctx.chapterId,
    lessonId: ctx.primaryLessonId,
    alsoPlausibleLessonIds: ctx.alsoPlausibleLessonIds,
    window: {
      fromLessonId: ctx.expectedWindow.fromLessonId,
      toLessonId: ctx.expectedWindow.toLessonId,
      widthLessons: ctx.expectedWindow.widthLessons,
      lessonIds: ctx.expectedWindow.lessonIds,
    },
    source: 'CURRICULUM_TIMELINE',
    confidence: 'ESTIMATED',
    asOfDate: ctx.asOfDate,
    paceDeltaApplied: ctx.paceDeltaApplied,
    calendar: ctx.calendar,
  };
}
