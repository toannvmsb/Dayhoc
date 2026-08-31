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
  plan_ready: { title: 'Kế hoạch hôm nay đã sẵn sàng', body: 'Khoảng vài phút cùng con là đủ cho hôm nay.' },
  weekly_report_ready: { title: 'Báo cáo tuần đã có', body: 'Xem con tiến bộ thế nào và gợi ý cho tuần tới.' },
  teacher_updated: { title: 'Giáo viên vừa cập nhật', body: 'Có nội dung mới con đã học trên lớp.' },
  child_finished_tasks: { title: 'Con đã hoàn thành bài hôm nay', body: 'Con vừa xong các việc được giao.' },
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
