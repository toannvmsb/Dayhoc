import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Screen } from '../../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { ExamPracticeButton, RecordResult, ScopeConfirm } from '../client';

export const dynamic = 'force-dynamic';

const PRACTICE_STATUS_LABEL: Record<string, string> = {
  ASSIGNED: 'Chưa làm',
  IN_PROGRESS: 'Đang làm',
  COMPLETED: 'Đã làm xong',
};

const BAND_LABEL: Record<string, string> = {
  ưu_tiên_cao: 'Ưu tiên cao',
  nhắc_lại: 'Nhắc lại',
  đã_ổn: 'Đã ổn',
};

export default async function ExamDetail({
  params,
}: {
  params: { childId: string; examId: string };
}) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let map;
  let diagnosis;
  try {
    [map, diagnosis] = await Promise.all([
      getApi().getRevisionMap(parentAuth(), params.childId, params.examId),
      getApi().getExamDiagnosis(parentAuth(), params.childId, params.examId),
    ]);
  } catch {
    notFound();
  }

  return (
    <Screen nav={null}>
      <Link href={`/be/${params.childId}/kiem-tra`} className="chip">‹ Kiểm tra</Link>
      <div>
        <span className="overline">
          {map.subject} · {map.examDate} · còn {map.dayCountdown} ngày
        </span>
        <h1 className="h1">Bản đồ ôn tập</h1>
      </div>

      {map.needsScopeConfirm && (
        <ScopeConfirm
          childId={params.childId}
          examId={params.examId}
          items={map.items.map((it) => ({ skillId: it.skillId, name: it.name }))}
        />
      )}

      <div className="card" style={{ gap: 8 }}>
        <span className="overline">Ưu tiên ôn — {map.dailyMinutes} phút/ngày</span>
        {map.items.map((it) => (
          <div key={it.skillId} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <b style={{ color: 'var(--c-text-heading)', fontSize: 13.5 }}>{it.name}</b>
              <span className="muted" style={{ fontSize: 11.5 }}>{BAND_LABEL[it.band] ?? it.band}</span>
            </span>
            <span style={{ fontSize: 12, color: 'var(--c-text-body)' }}>{it.reason}</span>
          </div>
        ))}
      </div>

      {!diagnosis && map.items.length > 0 && (
        <ExamPracticeButton childId={params.childId} examId={params.examId} />
      )}

      {map.practice.length > 0 && (
        <div className="card" style={{ gap: 8 }}>
          <span className="overline">Đề ôn thử đã giao</span>
          {map.practice.map((p, i) => (
            <Link
              key={p.assignmentId}
              href={`/be/${params.childId}/bai-tap`}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8, textDecoration: 'none', fontSize: 13.5 }}
            >
              <span style={{ color: 'var(--c-text-heading)' }}>
                Đề {map.practice.length - i} · {p.items} câu · {new Date(p.createdAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
              </span>
              <b style={{ color: p.status === 'COMPLETED' ? 'var(--c-primary)' : 'var(--c-text-body)' }}>
                {PRACTICE_STATUS_LABEL[p.status] ?? p.status}
              </b>
            </Link>
          ))}
        </div>
      )}

      {diagnosis ? (
        <div className="card" style={{ gap: 8 }}>
          <span className="overline">Chẩn đoán sau kiểm tra — đạt {diagnosis.totalAwardedPercent}%</span>
          {diagnosis.byCategory.map((c) => (
            <span key={c.category} style={{ fontSize: 13, color: 'var(--c-text-heading)' }}>
              {c.categoryLabel}: mất {c.lostPoints} điểm (theo tỉ lệ)
            </span>
          ))}
          <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 0' }} />
          {diagnosis.lostPoints.map((lp, i) => (
            <span key={i} style={{ fontSize: 12.5, color: 'var(--c-text-body)' }}>
              • {lp.skillName} — <b>{lp.categoryLabel}</b>: {lp.note}
            </span>
          ))}
          {diagnosis.remediation.length > 0 && (
            <span style={{ fontSize: 12.5, color: 'var(--c-text-faint)' }}>
              Nên ôn lại: {diagnosis.remediation.map((r) => r.name).join(', ')}
            </span>
          )}
        </div>
      ) : (
        <RecordResult
          childId={params.childId}
          examId={params.examId}
          items={map.items.map((it) => ({ skillId: it.skillId, name: it.name }))}
        />
      )}
    </Screen>
  );
}
