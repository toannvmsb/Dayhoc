'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { teacherSubmitContributionAction } from '@/lib/server/actions';
import { LessonPicker, SubmitButton, type LessonChapter } from '../../ui';

type Student = { childId: string; displayName: string; subjectId: string | null; schoolGrade: number };
type Subject = { id: string; name: string };

const TYPES = [
  { value: 'CURRENT_LESSON', label: 'Bài đang dạy' },
  { value: 'CURRICULUM_PROGRESS', label: 'Tiến độ chương trình' },
  { value: 'HOMEWORK', label: 'Bài tập về nhà' },
  { value: 'EXAM_NOTICE', label: 'Lịch kiểm tra' },
] as const;

const sel: React.CSSProperties = {
  height: 46,
  borderRadius: 'var(--r-input)',
  border: '1px solid var(--c-border)',
  padding: '0 12px',
  fontSize: 14.5,
  fontFamily: 'inherit',
  background: 'var(--c-surface)',
  color: 'var(--c-text-heading)',
};

export function ContributionForm({
  students,
  subjects,
  programsByGrade,
}: {
  students: Student[];
  subjects: Subject[];
  /** SGK chapter/lesson list per grade — so "Bài đang dạy" / "Tiến độ chương
   * trình" pick a real lesson instead of typing free text. */
  programsByGrade: Record<number, LessonChapter[]>;
}) {
  const [state, formAction] = useFormState(teacherSubmitContributionAction, {} as { error?: string; ok?: never });
  const [type, setType] = useState<string>('CURRENT_LESSON');
  const [childId, setChildId] = useState(students[0]?.childId ?? '');
  const [taughtSkillIds, setTaughtSkillIds] = useState<string[]>([]);
  const selectedStudent = students.find((s) => s.childId === childId);
  const needsLesson = type === 'CURRENT_LESSON' || type === 'CURRICULUM_PROGRESS';
  const chapters = selectedStudent ? programsByGrade[selectedStudent.schoolGrade] ?? [] : [];

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>Học sinh</span>
        <select name="childId" value={childId} onChange={(e) => setChildId(e.target.value)} style={sel}>
          {students.map((s) => (
            <option key={s.childId} value={s.childId}>{s.displayName}</option>
          ))}
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>Môn học</span>
        <select name="subjectId" defaultValue={selectedStudent?.subjectId ?? subjects[0]?.id ?? ''} style={sel}>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>Loại cập nhật</span>
        <select name="contributionType" value={type} onChange={(e) => setType(e.target.value)} style={sel}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>

      {needsLesson && (
        chapters.length > 0 ? (
          <>
            <input type="hidden" name="taughtSkillIds" value={taughtSkillIds.join(',')} />
            <LessonPicker
              key={selectedStudent?.childId} // reset the picker when switching student/grade
              chapters={chapters}
              label={type === 'CURRENT_LESSON' ? 'Hôm nay lớp học đến bài nào?' : 'Lớp đang học đến bài nào (tiến độ chương trình)?'}
              onChange={(_lessonId, skillIds) => setTaughtSkillIds(skillIds)}
            />
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Chưa có dữ liệu chương trình cho lớp này.</p>
        )
      )}

      {type === 'EXAM_NOTICE' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>Ngày kiểm tra</span>
          <input name="examDate" type="date" style={sel} />
        </label>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>
          {type === 'HOMEWORK'
            ? 'Mã / mô tả bài tập (phân tách bằng dấu phẩy)'
            : type === 'EXAM_NOTICE'
              ? 'Phạm vi kiểm tra'
              : 'Ghi chú (không bắt buộc)'}
        </span>
        <textarea name="note" rows={3} style={{ ...sel, height: 'auto', padding: 10 }} />
      </label>

      {state?.error && (
        <p className="card card--attention" style={{ margin: 0, fontSize: 13 }}>{state.error}</p>
      )}
      <SubmitButton>Gửi cập nhật</SubmitButton>
    </form>
  );
}
