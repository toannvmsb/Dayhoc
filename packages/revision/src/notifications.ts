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
 * Real providers now exist below: `ResendEmailAdapter` (transactional email,
 * same vendor + HTTP pattern already proven by the Tuzi project) and
 * `ExpoPushProvider` (free push via Expo's service). Both need a
 * `UserContactLookup` (email / push-token-by-userId) — implemented against
 * Postgres in `services/api` (`users.notification_email` /
 * `users.expo_push_token`, a migration + a push-token registration
 * endpoint), not here, so this package stays DB-free. Still NOT wired to any
 * trigger point in `production-api.ts` — the resolver + adapters are ready
 * to activate the moment `RESEND_API_KEY`/`DZ_PUSH_NOTIFICATIONS` are set,
 * but nothing calls `.send()` from an actual gap/plan/relationship event
 * yet. That wiring (deciding WHEN to fire each notification type against
 * the real request flow, plus any per-user opt-out) is a follow-up, not
 * done here.
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

/**
 * How a real provider looks up "how do I reach this user" — the piece the
 * doc comment above says didn't exist. Implemented against Postgres in
 * `services/api` (a `users.notification_email` / `users.expo_push_token`
 * column, populated at registration / by a push-token registration
 * endpoint); kept as an interface here so this package stays DB-free.
 */
export interface UserContactLookup {
  getEmail(userId: string): Promise<string | null>;
  getExpoPushToken(userId: string): Promise<string | null>;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export interface ResendEmailAdapterOptions {
  readonly apiKey: string;
  /** e.g. "DạyZi <no-reply@dayzi.vn>" — must be a Resend-verified sending domain. */
  readonly fromEmail: string;
  readonly appName: string;
  readonly contacts: UserContactLookup;
  /** Injectable for tests — defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Real transactional email via Resend (resend.com) — the exact HTTP call
 * pattern already proven in production by the Tuzi project's
 * `supabase/functions/auth-email` edge function (plain `fetch`, Bearer API
 * key, no SDK needed). A delivery failure (missing email, Resend erroring,
 * network down) is swallowed into `{delivered:false}` — notifications are
 * always best-effort, never something that can fail the caller's request.
 */
export class ResendEmailAdapter implements NotificationDeliveryAdapter {
  readonly name = 'resend';
  readonly #opts: ResendEmailAdapterOptions;
  constructor(opts: ResendEmailAdapterOptions) {
    this.#opts = opts;
  }

  async send(targetUserId: string, notification: Notification): Promise<{ delivered: boolean }> {
    const email = await this.#opts.contacts.getEmail(targetUserId);
    if (!email) return { delivered: false };
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px">${escapeHtml(this.#opts.appName)}</h2>
        <h3 style="margin:0 0 16px">${escapeHtml(notification.title)}</h3>
        <p>${escapeHtml(notification.body)}</p>
        <hr style="border:none;border-top:1px solid #ddd;margin:20px 0"/>
        <p style="font-size:12px;color:#888">Email tự động từ ${escapeHtml(this.#opts.appName)} — vui lòng không trả lời email này.</p>
      </div>`;
    try {
      const fetchFn = this.#opts.fetchImpl ?? fetch;
      const res = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#opts.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: this.#opts.fromEmail, to: [email], subject: notification.title, html }),
      });
      return { delivered: res.ok };
    } catch {
      return { delivered: false };
    }
  }
}

export interface ExpoPushProviderOptions {
  readonly contacts: UserContactLookup;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Real push via Expo's push notification service — free, no vendor API key
 * (unlike email, this needs no secret to activate; see the DZ_PUSH_NOTIFICATIONS
 * gate below for why it's still opt-in). Same shape as the Tuzi project's
 * `registerForPush()`/token flow: the CLIENT calls
 * `Notifications.getExpoPushTokenAsync()` and registers it server-side; this
 * adapter only ever POSTs to Expo's `push/send` endpoint with that token.
 */
export class ExpoPushProvider implements NotificationDeliveryAdapter {
  readonly name = 'expo-push';
  readonly #opts: ExpoPushProviderOptions;
  constructor(opts: ExpoPushProviderOptions) {
    this.#opts = opts;
  }

  async send(targetUserId: string, notification: Notification): Promise<{ delivered: boolean }> {
    const token = await this.#opts.contacts.getExpoPushToken(targetUserId);
    if (!token) return { delivered: false };
    try {
      const fetchFn = this.#opts.fetchImpl ?? fetch;
      const res = await fetchFn('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify([{ to: token, title: notification.title, body: notification.body, sound: 'default' }]),
      });
      if (!res.ok) return { delivered: false };
      const json = (await res.json()) as { data?: { status?: string }[] };
      return { delivered: json.data?.[0]?.status === 'ok' };
    } catch {
      return { delivered: false };
    }
  }
}

/** Fan out to every configured channel — a notification is "delivered" if
 * ANY channel accepted it (push might reach a phone with no data signal but
 * email still lands, or vice versa; the caller shouldn't have to pick one). */
export class CompositeNotificationProvider implements NotificationDeliveryAdapter {
  readonly name: string;
  readonly #channels: readonly NotificationDeliveryAdapter[];
  constructor(channels: readonly NotificationDeliveryAdapter[]) {
    this.#channels = channels;
    this.name = `composite(${channels.map((c) => c.name).join('+')})`;
  }
  async send(targetUserId: string, notification: Notification): Promise<{ delivered: boolean }> {
    const results = await Promise.all(this.#channels.map((c) => c.send(targetUserId, notification)));
    return { delivered: results.some((r) => r.delivered) };
  }
}

export interface NotificationProviderEnv {
  readonly DZ_NOTIFICATIONS?: string | undefined;
  readonly RESEND_API_KEY?: string | undefined;
  readonly NOTIFICATION_FROM_EMAIL?: string | undefined;
  readonly NOTIFICATION_APP_NAME?: string | undefined;
  /** Push needs no secret to work (Expo's service is free), so it's gated by
   * an explicit flag rather than "key present" — sending a real push to a
   * real phone should never happen just because a dev env lacks other config. */
  readonly DZ_PUSH_NOTIFICATIONS?: string | undefined;
}

/**
 * Pick the delivery adapter from the environment. `DZ_NOTIFICATIONS=console`
 * logs (dev only, ignores real channels). Otherwise: `RESEND_API_KEY` +
 * `NOTIFICATION_FROM_EMAIL` activate real email; `DZ_PUSH_NOTIFICATIONS=1`
 * activates real Expo push (needs `contacts` — without it, push can't look
 * up a device token and is skipped even if the flag is set). Zero channels
 * configured (including production today) — still `Noop`. `contacts` is
 * required to activate ANY real channel; omit it (e.g. from a context with
 * no DB) to force Noop/console regardless of other env vars.
 */
export function resolveNotificationProvider(
  env: NotificationProviderEnv,
  contacts?: UserContactLookup,
): {
  adapter: NotificationDeliveryAdapter;
  kind: 'console' | 'noop' | 'email' | 'push' | 'email+push';
} {
  if (env.DZ_NOTIFICATIONS === 'console') {
    return { adapter: new ConsoleNotificationProvider(), kind: 'console' };
  }
  if (!contacts) return { adapter: new NoopNotificationProvider(), kind: 'noop' };

  const channels: NotificationDeliveryAdapter[] = [];
  if (env.RESEND_API_KEY && env.NOTIFICATION_FROM_EMAIL) {
    channels.push(
      new ResendEmailAdapter({
        apiKey: env.RESEND_API_KEY,
        fromEmail: env.NOTIFICATION_FROM_EMAIL,
        appName: env.NOTIFICATION_APP_NAME ?? 'DạyZi',
        contacts,
      }),
    );
  }
  if (env.DZ_PUSH_NOTIFICATIONS === '1') {
    channels.push(new ExpoPushProvider({ contacts }));
  }
  if (channels.length === 0) return { adapter: new NoopNotificationProvider(), kind: 'noop' };
  if (channels.length === 1) {
    return { adapter: channels[0]!, kind: channels[0]!.name === 'resend' ? 'email' : 'push' };
  }
  return { adapter: new CompositeNotificationProvider(channels), kind: 'email+push' };
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
