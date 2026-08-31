import { teacherUpdateForm } from '@/lib/teacher-scene';

export default function TeacherUpdate() {
  const f = teacherUpdateForm();
  return (
    <div className="screen" style={{ background: 'var(--c-surface-teacher)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 14px' }}>
        <a href="/teacher" style={{ fontSize: 20, color: 'var(--c-text-heading)' }}>
          ✕
        </a>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text-heading)' }}>
          {f.dateLabel} · {f.classRef}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text-muted)' }}>≈{f.estimatedSeconds}s</span>
      </div>
      <div style={{ flex: 1, padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
        <Step n={1} label="Chủ đề đã dạy">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {f.topicChoices.slice(0, 6).map((t, i) => (
              <span
                key={t.skillId}
                style={{
                  padding: '11px 14px',
                  borderRadius: 11,
                  fontSize: 13.5,
                  fontWeight: i === 0 ? 700 : 600,
                  background: i === 0 ? 'var(--c-surface-inverse)' : 'var(--c-surface)',
                  color: i === 0 ? '#fff' : 'var(--c-text-label)',
                  border: i === 0 ? 'none' : '1px solid #e6e4df',
                }}
              >
                {t.name}
              </span>
            ))}
            <span style={{ padding: '11px 14px', borderRadius: 11, fontSize: 13.5, fontWeight: 600, border: '1px dashed #c9c6bf', color: 'var(--c-text-muted)' }}>
              + Khác
            </span>
          </div>
        </Step>

        <Step n={2} label="Dạng bài đã luyện">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {f.problemTypeChoices.slice(0, 3).map((pt, i) => (
              <div key={pt.problemTypeId} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 14px', background: 'var(--c-surface)', border: '1px solid #e6e4df', borderRadius: 13 }}>
                <span style={{ width: 20, height: 20, borderRadius: 6, background: i < 2 ? 'var(--c-primary)' : 'transparent', border: i < 2 ? 'none' : '2px solid #d4d1ca', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {i < 2 ? '✓' : ''}
                </span>
                <span style={{ fontSize: 14, color: i < 2 ? 'var(--c-text-heading)' : 'var(--c-text-label)' }}>{pt.name}</span>
              </div>
            ))}
          </div>
        </Step>

        <Step n={3} label="Bài về nhà">
          <div style={{ padding: 14, background: 'var(--c-surface)', border: '1px solid #e6e4df', borderRadius: 13, fontSize: 14, lineHeight: 1.5, color: 'var(--c-text-heading)' }}>
            SGK trang 12, bài 1–4. Nộp thứ Hai.
          </div>
        </Step>

        <Step n={4} label="Lịch kiểm tra (nếu có)">
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, padding: 14, background: 'var(--c-surface)', border: '1px solid #e6e4df', borderRadius: 13, fontSize: 14 }}>12/9</div>
            <div style={{ flex: 1.4, padding: 14, background: 'var(--c-surface)', border: '1px solid #e6e4df', borderRadius: 13, fontSize: 14, color: 'var(--c-text-muted)' }}>
              Phạm vi: chương 1
            </div>
          </div>
        </Step>
      </div>
      <div style={{ padding: '12px 20px 26px', borderTop: '1px solid #e6e4df' }}>
        <a href="/teacher" className="cta" style={{ borderRadius: 16 }}>
          Gửi cập nhật
        </a>
      </div>
    </div>
  );
}

function Step({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.06em', color: 'var(--c-text-muted)' }}>
        {n} · {label.toUpperCase()}
      </span>
      {children}
    </div>
  );
}
