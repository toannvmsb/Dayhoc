import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Screen } from '../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { PlanPicker } from './client';

export const dynamic = 'force-dynamic';

export default async function Plans() {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');
  if (!viewer.roles.includes('PARENT')) redirect('/');

  const ent = await getApi().getEntitlements(parentAuth());

  const features = [
    ['Số hồ sơ con', String(ent.entitlements.maxChildren)],
    [
      'Kết nối giáo viên / con',
      ent.entitlements.maxTeacherConnectionsPerChild === null
        ? 'Không giới hạn'
        : String(ent.entitlements.maxTeacherConnectionsPerChild),
    ],
    ['Phân tích ảnh bài / tháng', String(ent.entitlements.evidenceAnalysesPerMonth)],
    ['Ôn thi & chẩn đoán sau kiểm tra', ent.entitlements.examIntelligence ? 'Có' : '—'],
    ['DạyZi hướng dẫn bạn dạy con', ent.entitlements.teachingCopilot ? 'Có' : '—'],
    ['AI diễn giải tình hình học tập', ent.entitlements.aiInterpretation ? 'Có' : '—'],
    ['Báo cáo tuần', ent.entitlements.weeklyReport ? 'Có' : '—'],
  ] as const;

  return (
    <Screen nav={null}>
      <Link href="/" className="chip">‹ Trang chính</Link>
      <h1 className="h1">Gói dịch vụ</h1>
      <p className="card" style={{ margin: 0, fontSize: 12.5, color: 'var(--c-text-body)', lineHeight: 1.55 }}>
        Bản thử nghiệm: đổi gói <b>không phát sinh thanh toán</b>. Gói chỉ mở/khóa tính
        năng và hạn mức — <b>không</b> ảnh hưởng tới chất lượng hay mô hình AI mà DạyZi dùng.
      </p>

      <PlanPicker
        current={ent.plan}
        options={ent.options.map((o) => ({
          plan: o.plan,
          priceVnd: o.priceVnd,
          recommended: o.recommended,
        }))}
      />

      <div className="card" style={{ gap: 4 }}>
        <span className="overline">Gói {ent.plan} bao gồm</span>
        {features.map(([k, v]) => (
          <span key={k} style={{ fontSize: 13, color: 'var(--c-text-heading)', display: 'flex' }}>
            <span style={{ flex: 1 }}>{k}</span>
            <b>{v}</b>
          </span>
        ))}
      </div>
    </Screen>
  );
}
