'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState } from 'react-dom';
import {
  acceptRequestAsParentAction,
  createInviteCodeAction,
  rejectRequestAsParentAction,
  revokeTeacherLinkAction,
  updateTeacherPermissionsAction,
} from '@/lib/server/actions';
import { SubmitButton } from '../../../ui';

type Group = { title: string; note?: string; codes: { code: string; label: string }[] };

const GROUPS: Group[] = [
  {
    title: 'Thông tin lớp học',
    codes: [{ code: 'VIEW_CLASS_CONTEXT', label: 'Xem bối cảnh lớp con đang học' }],
  },
  {
    title: 'Bài học & bài giao',
    codes: [
      { code: 'SUBMIT_CURRENT_LESSON', label: 'Cập nhật bài đang dạy' },
      { code: 'SUBMIT_CURRICULUM_PROGRESS', label: 'Cập nhật tiến độ chương trình' },
      { code: 'SUBMIT_HOMEWORK', label: 'Cập nhật bài tập về nhà' },
      { code: 'SUBMIT_EXAM_NOTICE', label: 'Báo lịch kiểm tra' },
      { code: 'SUBMIT_EXAM_SCOPE', label: 'Báo phạm vi kiểm tra' },
      { code: 'VIEW_ASSIGNMENT_COMPLETION', label: 'Xem con đã hoàn thành bài giao chưa' },
    ],
  },
  {
    title: 'Thông tin học tập cá nhân',
    codes: [
      { code: 'VIEW_SELECTED_MASTERY', label: 'Xem mức độ nắm bài ở một số kỹ năng' },
      { code: 'SUBMIT_TEST_RESULT', label: 'Nhập kết quả bài kiểm tra' },
      { code: 'SUBMIT_SKILL_ASSESSMENT', label: 'Nhận xét mức độ nắm kỹ năng' },
      { code: 'SUBMIT_LEARNING_OBSERVATION', label: 'Ghi nhận quan sát học tập' },
    ],
  },
  {
    title: 'Nhạy cảm — mặc định tắt',
    note: 'Chỉ bật khi bạn thật sự muốn giáo viên thấy bức tranh học tập sâu của con.',
    codes: [
      { code: 'VIEW_LEARNING_TWIN_SUMMARY', label: 'Xem tóm tắt toàn cảnh mức độ hiểu bài' },
      { code: 'VIEW_SELECTED_GAPS', label: 'Xem những điểm con cần củng cố' },
    ],
  },
  {
    title: 'Trao đổi',
    codes: [{ code: 'MESSAGE_PARENT', label: 'Nhắn tin cho bố mẹ' }],
  },
];

export function TeacherLinkCard({
  childId,
  linkId,
  title,
  subtitle,
  granted,
}: {
  childId: string;
  linkId: string;
  title: string;
  subtitle: string;
  granted: string[];
}) {
  const [state, setState] = useState<Set<string>>(new Set(granted));
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty =
    [...state].sort().join(',') !== [...granted].sort().join(',');

  const toggle = (code: string) =>
    setState((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const save = () =>
    start(async () => {
      const grant = [...state].filter((c) => !granted.includes(c));
      const revoke = granted.filter((c) => !state.has(c));
      await updateTeacherPermissionsAction(childId, linkId, grant, revoke);
      router.refresh();
    });

  const revokeAll = () =>
    start(async () => {
      await revokeTeacherLinkAction(childId, linkId);
      router.refresh();
    });

  return (
    <div className="card" style={{ gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontWeight: 700, color: 'var(--c-text-heading)' }}>
          {title}
          {subtitle && (
            <span className="muted" style={{ display: 'block', fontWeight: 500 }}>{subtitle}</span>
          )}
        </span>
        <button type="button" onClick={revokeAll} disabled={pending} style={dangerBtn}>
          Ngừng kết nối
        </button>
      </div>

      {GROUPS.map((g) => (
        <div key={g.title} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--c-text-label)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {g.title}
          </span>
          {g.note && <span className="muted" style={{ fontSize: 11.5 }}>{g.note}</span>}
          {g.codes.map((c) => (
            <label key={c.code} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={state.has(c.code)} onChange={() => toggle(c.code)} />
              <span style={{ color: 'var(--c-text-heading)' }}>{c.label}</span>
            </label>
          ))}
        </div>
      ))}

      {dirty && (
        <button type="button" className="cta" onClick={save} disabled={pending}>
          {pending ? 'Đang lưu…' : 'Lưu thay đổi quyền'}
        </button>
      )}
    </div>
  );
}

export function PendingRequest({
  childId,
  requestId,
  label,
  proposed,
}: {
  childId: string;
  requestId: string;
  label: string;
  proposed: string[];
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const labelFor = (code: string) =>
    GROUPS.flatMap((g) => g.codes).find((c) => c.code === code)?.label ?? code;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8 }}>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--c-text-heading)' }}>{label}</span>
      <span className="muted" style={{ fontSize: 12 }}>
        Đề nghị quyền: {proposed.length ? proposed.map(labelFor).join(', ') : 'cơ bản'}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="cta"
          style={{ flex: 1 }}
          disabled={pending}
          onClick={() =>
            start(async () => {
              await acceptRequestAsParentAction(childId, requestId);
              router.refresh();
            })
          }
        >
          Chấp thuận
        </button>
        <button
          type="button"
          disabled={pending}
          style={dangerBtn}
          onClick={() =>
            start(async () => {
              await rejectRequestAsParentAction(childId, requestId);
              router.refresh();
            })
          }
        >
          Từ chối
        </button>
      </div>
    </div>
  );
}

export function InviteCode({
  childId,
  subjects,
}: {
  childId: string;
  subjects: { id: string; name: string }[];
}) {
  const [state, formAction] = useFormState(createInviteCodeAction, {} as { error?: string; code?: string });
  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
      <input type="hidden" name="childId" value={childId} />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>Môn (không bắt buộc)</span>
        <select
          name="subjectId"
          defaultValue=""
          style={{
            height: 44,
            borderRadius: 'var(--r-input)',
            border: '1px solid var(--c-border)',
            padding: '0 12px',
            fontSize: 14.5,
            fontFamily: 'inherit',
          }}
        >
          <option value="">Chưa gắn môn</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      {state?.code && (
        <p className="card card--teal" style={{ margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: 1, color: '#fff' }}>
          {state.code}
        </p>
      )}
      {state?.error && (
        <p className="card card--attention" style={{ margin: 0, fontSize: 13 }}>{state.error}</p>
      )}
      <SubmitButton>Tạo mã kết nối</SubmitButton>
      <span className="muted">
        Gửi mã này cho giáo viên. Mã chỉ tạo yêu cầu — bạn vẫn duyệt và chọn quyền sau.
      </span>
    </form>
  );
}

const dangerBtn: React.CSSProperties = {
  border: '1px solid var(--c-border)',
  borderRadius: 10,
  padding: '7px 12px',
  background: 'var(--c-surface)',
  color: 'var(--c-attention-text)',
  fontWeight: 700,
  fontSize: 12.5,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
