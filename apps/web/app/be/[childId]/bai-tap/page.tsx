import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ParentNav, Screen } from '../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { CreatePracticeButton } from './create-button';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: 'Chưa làm',
  IN_PROGRESS: 'Đang làm',
  COMPLETED: 'Đã xong',
  CANCELLED: 'Đã huỷ',
};

export default async function Assignments({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  const list = await getApi().getChildAssignments(parentAuth(), params.childId);
  const open = list.filter((a) => a.status !== 'COMPLETED' && a.status !== 'CANCELLED');
  const done = list.filter((a) => a.status === 'COMPLETED');

  return (
    <Screen nav={<ParentNav childId={params.childId} active="practice" />}>
      <h1 className="h1">Bài tập</h1>
      <CreatePracticeButton childId={params.childId} />

      {open.length === 0 && done.length === 0 && (
        <p className="card" style={{ margin: 0, fontSize: 14, color: 'var(--c-text-body)' }}>
          Hôm nay con chưa có bài được giao. Nhấn “Tạo bài luyện tập” để DạyZi soạn
          một buổi luyện ngắn phù hợp với con.
        </p>
      )}

      {open.map((a) => (
        <Link key={a.id} href={`/bai/${a.id}`} className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1, fontWeight: 700, color: 'var(--c-text-heading)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Buổi luyện tập
              {a.source === 'AI_GENERATED' && (
                <span
                  title="DạyZi AI soạn riêng cho con, theo đúng bài con đang học"
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: 'var(--c-primary)',
                    background: 'var(--c-primary-tint, rgba(59,91,255,.1))',
                    borderRadius: 999,
                    padding: '2px 8px',
                  }}
                >
                  ✨ AI soạn riêng
                </span>
              )}
            </span>
            <span className="muted" style={{ display: 'block', fontWeight: 500 }}>
              {a.targetSkillIds.length} kỹ năng · {STATUS_LABEL[a.status]}
            </span>
          </span>
          <span style={{ color: 'var(--c-primary)', fontWeight: 700 }}>Làm bài ›</span>
        </Link>
      ))}

      {done.length > 0 && (
        <div className="card">
          <span className="overline">Đã hoàn thành</span>
          {done.map((a) => (
            <div key={a.id} style={{ fontSize: 13.5, color: 'var(--c-text-body)' }}>
              Buổi luyện tập{a.source === 'AI_GENERATED' ? ' ✨' : ''} — {a.completedAt?.slice(0, 10) ?? 'xong'}
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}
