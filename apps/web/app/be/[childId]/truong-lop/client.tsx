'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState } from 'react-dom';
import {
  createClassEnrollmentAction,
  createSchoolEnrollmentAction,
  listClassroomsAction,
  proposeClassAction,
  proposeSchoolAction,
  searchSchoolsAction,
  setClassPrivacyAction,
} from '@/lib/server/actions';
import { SubmitButton } from '../../../ui';

type School = { id: string; officialName: string; province: string | null; district: string | null };
type Classroom = { id: string; grade: number; className: string; displayName: string };

const inp: React.CSSProperties = {
  height: 44,
  borderRadius: 'var(--r-input)',
  border: '1px solid var(--c-border)',
  padding: '0 12px',
  fontSize: 14.5,
  fontFamily: 'inherit',
  background: 'var(--c-surface)',
  color: 'var(--c-text-heading)',
};

const PRIVACY_OPTIONS = [
  { value: 'PRIVATE_LEARNING', label: 'Riêng tư — chỉ bố mẹ' },
  { value: 'LINKED_PRIVATE', label: 'Gắn lớp, dữ liệu vẫn riêng' },
  { value: 'LINKED_SHARED', label: 'Gắn lớp & cho giáo viên phụ trách cập nhật' },
];

const CLASS_TYPES = [
  { value: 'PRIMARY', label: 'Lớp chính' },
  { value: 'SUPPLEMENTARY', label: 'Lớp học thêm' },
  { value: 'HSG_TEAM', label: 'Đội tuyển HSG' },
  { value: 'TUTOR_GROUP', label: 'Nhóm gia sư' },
];

export function SchoolClassManager({
  childId,
  grade,
  academicYearId,
  academicYearLabel,
  classEnrollments,
  hasSchool,
}: {
  childId: string;
  grade: number;
  academicYearId: string;
  academicYearLabel: string;
  classEnrollments: { id: string; label: string; privacyMode: string }[];
  hasSchool: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<School[]>([]);
  const [picked, setPicked] = useState<School | null>(null);
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [newClassName, setNewClassName] = useState('');
  const [classType, setClassType] = useState('PRIMARY');
  const [privacy, setPrivacy] = useState('LINKED_PRIVATE');
  const [proposeState, proposeAction] = useFormState(proposeSchoolAction, {} as { error?: string });

  const search = () =>
    start(async () => {
      setResults(await searchSchoolsAction(query));
    });

  const pick = (s: School) =>
    start(async () => {
      setPicked(s);
      setResults([]);
      if (academicYearId) setClasses(await listClassroomsAction(s.id, academicYearId));
    });

  const enrollSchool = () =>
    start(async () => {
      if (!picked || !academicYearId) return;
      await createSchoolEnrollmentAction(childId, { schoolId: picked.id, academicYearId, grade });
      router.refresh();
    });

  const addClass = () =>
    start(async () => {
      if (!picked || !academicYearId || !newClassName.trim()) return;
      const res = await proposeClassAction(picked.id, academicYearId, grade, newClassName.trim());
      setClasses((cs) => [...cs, { id: res.id, grade, className: res.className, displayName: res.className }]);
      setNewClassName('');
    });

  const enrollClass = (classroomId: string) =>
    start(async () => {
      if (!academicYearId) return;
      await createClassEnrollmentAction(childId, {
        classroomId,
        academicYearId,
        enrollmentType: classType as 'PRIMARY' | 'SUPPLEMENTARY' | 'HSG_TEAM' | 'TUTOR_GROUP',
        privacyMode: privacy as 'PRIVATE_LEARNING' | 'LINKED_PRIVATE' | 'LINKED_SHARED',
      });
      router.refresh();
    });

  const changePrivacy = (id: string, mode: string) =>
    start(async () => {
      await setClassPrivacyAction(
        childId,
        id,
        mode as 'PRIVATE_LEARNING' | 'LINKED_PRIVATE' | 'LINKED_SHARED',
      );
      router.refresh();
    });

  return (
    <>
      {classEnrollments.length > 0 && (
        <div className="card" style={{ gap: 10 }}>
          <span className="overline">Đổi chế độ chia sẻ của lớp</span>
          {classEnrollments.map((c) => (
            <label key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-heading)' }}>{c.label}</span>
              <select
                value={c.privacyMode}
                onChange={(e) => changePrivacy(c.id, e.target.value)}
                disabled={pending}
                style={inp}
              >
                {PRIVACY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      <div className="card" style={{ gap: 10 }}>
        <span className="overline">{hasSchool ? 'Thêm / đổi trường' : 'Khai báo trường'}</span>
        {academicYearLabel && <span className="muted">Năm học {academicYearLabel}</span>}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo tên trường"
            style={{ ...inp, flex: 1 }}
          />
          <button type="button" className="cta" style={{ width: 'auto', padding: '0 16px' }} onClick={search} disabled={pending}>
            Tìm
          </button>
        </div>

        {results.map((s) => (
          <button key={s.id} type="button" onClick={() => pick(s)} className="child-task" style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>
            <b style={{ color: 'var(--c-text-heading)' }}>{s.officialName}</b>
            <span className="muted" style={{ display: 'block' }}>
              {[s.district, s.province].filter(Boolean).join(', ')}
            </span>
          </button>
        ))}

        {picked && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              Đã chọn: <b>{picked.officialName}</b>
            </p>
            <button type="button" className="cta" onClick={enrollSchool} disabled={pending}>
              Gắn trường này cho con (lớp {grade})
            </button>
          </div>
        )}

        <details>
          <summary className="muted" style={{ cursor: 'pointer' }}>Không tìm thấy trường?</summary>
          <form action={proposeAction} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <input type="hidden" name="childId" value={childId} />
            <input name="officialName" placeholder="Tên trường đầy đủ" required style={inp} />
            <input name="province" placeholder="Tỉnh / thành phố" style={inp} />
            <input name="district" placeholder="Quận / huyện" style={inp} />
            {proposeState?.error && (
              <p className="card card--attention" style={{ margin: 0, fontSize: 13 }}>{proposeState.error}</p>
            )}
            <SubmitButton>Đề xuất trường mới</SubmitButton>
            <span className="muted">Trường đề xuất chờ xác minh, vẫn dùng được ngay.</span>
          </form>
        </details>
      </div>

      {picked && (
        <div className="card" style={{ gap: 10 }}>
          <span className="overline">Gắn con vào lớp</span>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={newClassName}
              onChange={(e) => setNewClassName(e.target.value)}
              placeholder="Tên lớp, VD: 7A2"
              style={{ ...inp, flex: 1 }}
            />
            <button
              type="button"
              className="cta"
              style={{ width: 'auto', padding: '0 14px' }}
              onClick={addClass}
              disabled={pending || !newClassName.trim()}
            >
              Thêm lớp
            </button>
          </div>
          {classes.length === 0 && (
            <span className="muted">Trường chưa có lớp nào trên hệ thống — tạo lớp của con ở trên.</span>
          )}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>Loại lớp</span>
            <select value={classType} onChange={(e) => setClassType(e.target.value)} style={inp}>
              {CLASS_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>Chế độ chia sẻ</span>
            <select value={privacy} onChange={(e) => setPrivacy(e.target.value)} style={inp}>
              {PRIVACY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          {classes.map((c) => (
            <button key={c.id} type="button" onClick={() => enrollClass(c.id)} disabled={pending} className="child-task" style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>
              Lớp {c.className} · khối {c.grade} — <span style={{ color: 'var(--c-primary)', fontWeight: 700 }}>gắn ›</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
