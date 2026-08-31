import { teacherHomeView } from '@/lib/teacher-scene';

export default function TeacherHome() {
  const v = teacherHomeView();
  const pending = v.classes.find((c) => !c.updatedToday);
  return (
    <div className="screen" style={{ background: 'var(--c-surface-teacher)' }}>
      <div style={{ padding: '14px 20px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: '#3b4642', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
          TH
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-text-heading)' }}>{v.teacherName}</span>
          <span className="muted">
            {v.subject} · {v.classes.map((c) => c.classRef).join(', ')}
          </span>
        </div>
      </div>
      <div style={{ flex: 1, padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ padding: 18, background: 'var(--c-surface-inverse)', borderRadius: 20, color: '#fff', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="overline" style={{ color: 'rgba(255,255,255,.55)' }}>
            Cập nhật hôm nay
          </span>
          <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.4 }}>
            {pending ? `Bạn chưa cập nhật buổi hôm nay (${pending.classRef})` : 'Đã cập nhật tất cả lớp hôm nay'}
          </span>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(255,255,255,.6)' }}>
            Khoảng 40 giây. Phụ huynh dùng thông tin này để dạy con buổi tối.
          </span>
          <a href="/teacher/update" style={{ height: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--c-primary)', borderRadius: 14, fontSize: 15.5, fontWeight: 800, color: '#fff' }}>
            Cập nhật bài đã dạy
          </a>
        </div>

        <div className="card" style={{ borderColor: '#e6e4df' }}>
          <span className="overline" style={{ color: 'var(--c-text-faint)' }}>
            Lớp của bạn
          </span>
          {v.classes.map((c, i) => (
            <div key={c.classRef} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderTop: i ? '1px solid #f0eeea' : 'none' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text-heading)' }}>{c.classRef}</span>
                <span className="muted">{c.connectedParents} phụ huynh đã kết nối</span>
              </span>
              <span className="chip" style={c.updatedToday ? { background: 'var(--c-primary-tint)', color: 'var(--c-on-primary-tint)', fontWeight: 700 } : { background: 'var(--c-attention-bg)', color: 'var(--c-attention-text)', fontWeight: 700 }}>
                {c.lastUpdatedLabel}
              </span>
            </div>
          ))}
        </div>

        <div className="card" style={{ borderColor: '#e6e4df' }}>
          <span className="overline" style={{ color: 'var(--c-text-faint)' }}>
            Lịch sử gần đây
          </span>
          {v.recentHistory.map((h, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text-heading)' }}>{h.topic}</span>
                <span className="muted">{h.detail}</span>
              </span>
              <span className="muted" style={{ whiteSpace: 'nowrap' }}>
                {h.dateLabel}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
