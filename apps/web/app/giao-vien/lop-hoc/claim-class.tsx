'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  teacherClaimClassAction,
  teacherListClassroomsAction,
  teacherSearchSchoolsAction,
} from '@/lib/server/actions';

type School = { id: string; officialName: string; province: string | null; district: string | null };
type Classroom = { id: string; label: string };

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

/** "Tôi dạy lớp này": search the school, pick the class, declare it. Parents still approve every student. */
export function ClaimClass() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState('');
  const [schools, setSchools] = useState<School[]>([]);
  const [picked, setPicked] = useState<School | null>(null);
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [searched, setSearched] = useState(false);

  const search = () =>
    start(async () => {
      setSchools(await teacherSearchSchoolsAction(query));
      setSearched(true);
    });

  const pick = (s: School) =>
    start(async () => {
      setPicked(s);
      setSchools([]);
      setClasses(await teacherListClassroomsAction(s.id));
    });

  const claim = (id: string) =>
    start(async () => {
      await teacherClaimClassAction(id);
      setPicked(null);
      setClasses([]);
      setQuery('');
      router.refresh();
    });

  return (
    <div className="card" style={{ gap: 10 }}>
      <span className="overline">Thêm lớp tôi dạy</span>
      {!picked ? (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...inp, flex: 1 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tên trường (từ 2 ký tự)"
            />
            <button type="button" className="chip" disabled={pending || query.trim().length < 2} onClick={search}>
              Tìm
            </button>
          </div>
          {schools.map((s) => (
            <button
              key={s.id}
              type="button"
              className="chip"
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => pick(s)}
            >
              {s.officialName}
              {s.district || s.province ? ` · ${[s.district, s.province].filter(Boolean).join(', ')}` : ''}
            </button>
          ))}
          {searched && schools.length === 0 ? (
            <span className="muted" style={{ fontSize: 12.5 }}>Không thấy trường nào. Phụ huynh khai báo trường/lớp trước thì mới có ở đây.</span>
          ) : null}
        </>
      ) : (
        <>
          <b style={{ fontSize: 13.5, color: 'var(--c-text-heading)' }}>{picked.officialName}</b>
          {classes.length === 0 ? (
            <span className="muted" style={{ fontSize: 12.5 }}>Trường này chưa có lớp nào trong năm học hiện tại.</span>
          ) : (
            classes.map((c) => (
              <button key={c.id} type="button" className="chip" disabled={pending} onClick={() => claim(c.id)}>
                Tôi dạy {c.label}
              </button>
            ))
          )}
          <button type="button" className="chip" onClick={() => { setPicked(null); setClasses([]); }}>
            ‹ Chọn trường khác
          </button>
        </>
      )}
    </div>
  );
}
