import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Screen } from '../../../components';
import { ActionForm } from '../../../ui';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { setPreferencesAction } from '@/lib/server/actions';

export const dynamic = 'force-dynamic';

const optionStyle = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
  padding: '10px 12px',
  border: '1px solid var(--c-border)',
  borderRadius: 12,
  cursor: 'pointer',
} as const;

export default async function LearningGoals({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let child;
  let prefs;
  try {
    [child, prefs] = await Promise.all([
      getApi().getChild(parentAuth(), params.childId),
      getApi().getChildPreferences(parentAuth(), params.childId),
    ]);
  } catch {
    notFound();
  }
  const name = 'displayName' in child ? child.displayName : 'con';

  return (
    <Screen nav={null}>
      <Link href={`/be/${params.childId}/cai-dat`} className="chip">‹ Cài đặt</Link>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="overline">Mục tiêu học</span>
        <h1 className="h1">Bố mẹ muốn {name} học thế nào?</h1>
        <p style={{ margin: 0, color: 'var(--c-text-body)', fontSize: 14.5, lineHeight: 1.55 }}>
          DạyZi dùng lựa chọn này để chọn độ khó và độ dài bài ôn mỗi ngày. Bố mẹ đổi lúc nào cũng được.
        </p>
      </div>

      <ActionForm action={setPreferencesAction} submitLabel="Lưu">
        <input type="hidden" name="childId" value={params.childId} />

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend className="overline" style={{ marginBottom: 6 }}>Mục tiêu chính</legend>
          {prefs.goalOptions.map((g) => (
            <label key={g.code} style={optionStyle}>
              <input type="radio" name="goal" value={g.code} defaultChecked={g.code === prefs.goal} style={{ marginTop: 3 }} />
              <span>
                <b style={{ color: 'var(--c-text-heading)', fontSize: 14 }}>{g.label}</b>
                <span className="muted" style={{ display: 'block', fontSize: 12.5, lineHeight: 1.5 }}>{g.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label style={optionStyle}>
          <input type="checkbox" name="examPrep" defaultChecked={prefs.examPrep} style={{ marginTop: 3 }} />
          <span>
            <b style={{ color: 'var(--c-text-heading)', fontSize: 14 }}>Con sắp có bài kiểm tra / thi</b>
            <span className="muted" style={{ display: 'block', fontSize: 12.5, lineHeight: 1.5 }}>
              Bố mẹ khai báo kỳ thi ở mục Kiểm tra để DạyZi ra bài ôn đúng phạm vi.
            </span>
          </span>
        </label>

        <label style={optionStyle}>
          <input type="checkbox" name="reminders" defaultChecked={prefs.reminders} style={{ marginTop: 3 }} />
          <span>
            <b style={{ color: 'var(--c-text-heading)', fontSize: 14 }}>Nhắc bố mẹ khi con chưa làm bài 2 ngày</b>
            <span className="muted" style={{ display: 'block', fontSize: 12.5, lineHeight: 1.5 }}>
              DạyZi gửi tối đa 3 lời nhắc, cách nhau ít nhất 3 ngày, rồi dừng nếu con vẫn chưa quay lại.
            </span>
          </span>
        </label>

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend className="overline" style={{ marginBottom: 6 }}>Số phút học mỗi ngày</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {prefs.minuteOptions.map((m) => (
              <label key={m} className="chip" style={{ cursor: 'pointer', gap: 6 }}>
                <input type="radio" name="dailyMinutes" value={m} defaultChecked={m === prefs.dailyMinutes} />
                {m} phút
              </label>
            ))}
          </div>
        </fieldset>
      </ActionForm>
    </Screen>
  );
}
