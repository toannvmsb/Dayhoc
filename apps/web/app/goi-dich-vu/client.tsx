'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPlanAction } from '@/lib/server/actions';

const LABEL: Record<string, string> = {
  free: 'Miễn phí',
  basic: 'Cơ bản',
  plus: 'Plus',
  pro: 'Pro',
};

export function PlanPicker({
  current,
  options,
}: {
  current: string;
  options: { plan: string; priceVnd: number | null; recommended: boolean }[];
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {options.map((o) => {
        const active = o.plan === current;
        return (
          <button
            key={o.plan}
            type="button"
            disabled={pending || active}
            onClick={() =>
              start(async () => {
                await setPlanAction(o.plan);
                router.refresh();
              })
            }
            className="card"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              cursor: active ? 'default' : 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
              border: `1px solid ${active ? 'var(--c-primary)' : o.recommended ? 'var(--c-primary)' : 'var(--c-border)'}`,
              background: active ? 'var(--c-primary-tint)' : 'var(--c-surface)',
            }}
          >
            <span style={{ flex: 1 }}>
              <b style={{ color: 'var(--c-text-heading)' }}>
                {LABEL[o.plan] ?? o.plan}
                {o.recommended ? ' · Khuyên dùng' : ''}
              </b>
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                {o.priceVnd === null ? 'Miễn phí' : `${(o.priceVnd / 1000).toLocaleString('vi-VN')}K / tháng`}
              </span>
            </span>
            <span style={{ color: 'var(--c-primary)', fontWeight: 700, fontSize: 13 }}>
              {active ? 'Đang dùng' : pending ? '…' : 'Chọn'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
