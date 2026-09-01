import { BottomNav, Screen } from '../components';

const LINKS: { href: string; label: string; sub: string }[] = [
  { href: '/', label: 'Hôm nay (bố mẹ)', sub: 'Học cùng con · kế hoạch hôm nay' },
  { href: '/progress', label: 'Tiến bộ', sub: '3 trục: kiến thức · dạng bài · tư duy' },
  { href: '/gap/demo', label: 'Chi tiết một lỗ hổng', sub: 'Vì sao con sai + hướng củng cố' },
  { href: '/exam', label: 'Ôn thi', sub: 'Phạm vi suy ra + kế hoạch ôn' },
  { href: '/weekly', label: 'Báo cáo tuần', sub: 'Con đã học gì · tiến bộ · tuần tới' },
  { href: '/child', label: 'Màn hình của Con', sub: 'Chỉ bài được giao — không có phân tích' },
  { href: '/child/do', label: 'Con · làm bài', sub: 'Thang gợi ý 6 bậc' },
  { href: '/child/challenge', label: 'Con · thử thách tư duy', sub: 'Bài không theo khuôn' },
  { href: '/child/result', label: 'Con · kết quả', sub: 'Phản hồi nhẹ nhàng' },
  { href: '/teacher', label: 'Màn hình Giáo viên', sub: 'Chỉ ngữ cảnh được mời' },
  { href: '/teacher/update', label: 'Giáo viên · cập nhật bài dạy', sub: '< 60 giây' },
];

export default function MorePage() {
  return (
    <Screen nav={<BottomNav active="more" />}>
      <h1 className="h1" style={{ fontSize: 'var(--fs-screen-title)' }}>
        Tất cả màn hình
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--c-text-faint)', margin: 0 }}>
        Bản demo — dữ liệu giả lập, cùng engine như bản thật.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="card"
            style={{ gap: 3, textDecoration: 'none', color: 'inherit' }}
          >
            <span style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--c-text-heading)' }}>{l.label}</span>
            <span style={{ fontSize: 12.5, color: 'var(--c-text-faint)' }}>{l.sub}</span>
          </a>
        ))}
      </div>
    </Screen>
  );
}
