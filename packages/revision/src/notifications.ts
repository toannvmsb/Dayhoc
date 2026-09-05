import type { GapEngineResult } from '@copilot/gap-engine';
import type { Notification, NotificationType } from '@copilot/domain';

export interface NotificationTrigger {
  readonly targetUserId: string;
  readonly at: string; // ISO
  readonly newId: () => string;
}

const TEMPLATE: Record<NotificationType, { title: string; body: string }> = {
  gap_detected: { title: 'Có điểm cần củng cố', body: 'App phát hiện một phần con đang cần củng cố. Xem khuyến nghị nhé.' },
  exam_upcoming: { title: 'Sắp tới kỳ kiểm tra', body: 'App đã đưa phần ôn liên quan vào kế hoạch hằng ngày.' },
  revision_reminder: { title: 'Đến giờ ôn tập rồi', body: 'Một vài phút hôm nay để con vững hơn trước kỳ kiểm tra.' },
  plan_ready: { title: 'Kế hoạch hôm nay đã sẵn sàng', body: 'Khoảng vài phút cùng con là đủ cho hôm nay.' },
  weekly_report_ready: { title: 'Báo cáo tuần đã có', body: 'Xem con tiến bộ thế nào và gợi ý cho tuần tới.' },
  teacher_updated: { title: 'Giáo viên vừa cập nhật', body: 'Có nội dung mới con đã học trên lớp.' },
  child_finished_tasks: { title: 'Con đã hoàn thành bài hôm nay', body: 'Con vừa xong các việc được giao.' },
  relationship_request_received: { title: 'Có yêu cầu kết nối mới', body: 'Một giáo viên/phụ huynh muốn kết nối với hồ sơ của con.' },
};

export function makeNotification(
  type: NotificationType,
  trigger: NotificationTrigger,
  overrides?: Partial<Pick<Notification, 'title' | 'body'>>,
): Notification {
  const t = TEMPLATE[type];
  return {
    id: `ntf_${trigger.newId()}`,
    targetUserId: trigger.targetUserId,
    type,
    title: overrides?.title ?? t.title,
    body: overrides?.body ?? t.body,
    createdAt: trigger.at,
    readAt: null,
  };
}

/**
 * Delivery port (P7 — productionization). `makeNotification`/`notificationsForRun`
 * above only ever decide WHAT the notification is; nothing in this codebase
 * previously attempted to actually SEND one anywhere. This is that missing
 * seam — swappable per-channel, same shape as the storage/vision/AI adapters
 * elsewhere in the codebase (structured but inert without real credentials).
 *
 * Building a real provider needs two things beyond this interface, neither of
 * which exists yet and neither of which this port can supply on its own:
 *   1. a chosen provider (e.g. Expo push notification service or FCM for
 *      push; Resend/SendGrid/SES for transactional email) + its API key —
 *      a product/vendor decision, not something to guess;
 *   2. a device-push-token / notification-email-preference table — there is
 *      currently no schema to look up "how do I reach this user" at all, so
 *      even with a provider key, delivery has nowhere to route to yet. That's
 *      a real feature (a migration + a registration endpoint), out of scope
 *      for "prepare the abstraction".
 */
export interface NotificationDeliveryAdapter {
  readonly name: string;
  /** Best-effort — a delivery failure must never fail the caller's request. */
  send(targetUserId: string, notification: Notification): Promise<{ delivered: boolean }>;
}

/** The default — attempts nothing, always reports not-delivered. Safe with no
 * provider configured; never throws. */
export class NoopNotificationProvider implements NotificationDeliveryAdapter {
  readonly name = 'noop';
  send(): Promise<{ delivered: boolean }> {
    return Promise.resolve({ delivered: false });
  }
}

/** Dev adapter — logs to the console instead of a real push/email send. */
export class ConsoleNotificationProvider implements NotificationDeliveryAdapter {
  readonly name = 'console';
  send(targetUserId: string, notification: Notification): Promise<{ delivered: boolean }> {
    // eslint-disable-next-line no-console
    console.warn('[notify]', JSON.stringify({ targetUserId, type: notification.type, title: notification.title }));
    return Promise.resolve({ delivered: true });
  }
}

export interface NotificationProviderEnv {
  readonly DZ_NOTIFICATIONS?: string | undefined;
}

/**
 * Pick the delivery adapter from the environment. `DZ_NOTIFICATIONS=console`
 * logs (dev only); anything else — including production today — is `Noop`
 * until a real push/email provider is written and wired here.
 */
export function resolveNotificationProvider(env: NotificationProviderEnv): {
  adapter: NotificationDeliveryAdapter;
  kind: 'console' | 'noop';
} {
  if (env.DZ_NOTIFICATIONS === 'console') {
    return { adapter: new ConsoleNotificationProvider(), kind: 'console' };
  }
  return { adapter: new NoopNotificationProvider(), kind: 'noop' };
}

/** Fan out the notifications a fresh engine run warrants (deterministic). */
export function notificationsForRun(
  gaps: GapEngineResult,
  examCountdownDays: number | undefined,
  trigger: NotificationTrigger,
): Notification[] {
  const out: Notification[] = [];
  if (gaps.gaps.some((g) => g.type !== 'careless_error' && g.score.band === 'high')) {
    out.push(makeNotification('gap_detected', trigger));
  }
  if (examCountdownDays !== undefined && examCountdownDays <= 14) {
    out.push(makeNotification('exam_upcoming', trigger));
  }
  return out;
}
