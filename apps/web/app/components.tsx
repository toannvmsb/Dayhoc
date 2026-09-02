import type { ReactNode } from 'react';
import type {
  ParentHomeView,
  ParentProgressView,
  SkillProgressRow,
  StatusWord,
  TodayPlanView,
} from '@copilot/api-contract';

const STATUS_TEXT: Record<StatusWord, string> = {
  trên_mức_mục_tiêu: 'Trên mức mục tiêu',
  đúng_mức_mục_tiêu: 'Đúng mức mục tiêu',
  đang_củng_cố: 'Đang củng cố',
  chưa_ổn_định: 'Chưa ổn định',
};
const STATUS_COLOR: Record<StatusWord, string> = {
  trên_mức_mục_tiêu: 'var(--c-positive-text)',
  đúng_mức_mục_tiêu: 'var(--c-positive-text)',
  đang_củng_cố: 'var(--c-unstable-text)',
  chưa_ổn_định: 'var(--c-unstable-text)',
};
const MIX_COLORS = ['#fff', 'var(--c-mix-gap)', 'var(--c-mix-advanced)', 'var(--c-mix-thinking)'];

export function ChildSwitcher({ name, sub }: { name: string; sub: string }) {
  return (
    <div className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: '10px 12px' }}>
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 14,
          background: 'var(--c-primary)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
        }}
      >
        {name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontWeight: 700, color: 'var(--c-text-heading)' }}>{name}</span>
        <span className="muted">{sub}</span>
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-primary)' }}>Đổi ›</span>
    </div>
  );
}

export function LearningContextCard({ ctx }: { ctx: ParentHomeView['learningContext'] }) {
  const estimated = ctx.status === 'ESTIMATED_FROM_CALENDAR';
  return (
    <div className="card">
      <span className="overline">{estimated ? 'Dự kiến con đang học' : 'Con đang học'}</span>
      <span className="h2">{ctx.headline}</span>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 2,
          fontSize: 12.5,
          fontWeight: 600,
          color: estimated ? 'var(--c-text-faint)' : 'var(--c-primary-strong)',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: estimated ? 'var(--c-text-faint)' : 'var(--c-primary)',
          }}
        />
        {ctx.statusLabel}
      </div>
      {ctx.estimatedLessonName ? (
        <span style={{ fontSize: 12.5, color: 'var(--c-text-faint)', marginTop: 2 }}>
          Lịch chương trình dự kiến: {ctx.estimatedLessonName}
        </span>
      ) : null}
      {ctx.hasConflict ? (
        <span style={{ fontSize: 12.5, color: 'var(--c-attention-text)', fontWeight: 600, marginTop: 2 }}>
          Có nguồn chưa khớp — bố mẹ xác nhận giúp
        </span>
      ) : null}
      {estimated ? (
        <span className="chip" style={{ marginTop: 6, alignSelf: 'flex-start' }}>DạyZi đang ước tính</span>
      ) : null}
    </div>
  );
}

const MIX_LABELS = ['Bài trên lớp', 'Củng cố', 'Nâng cao', 'Tư duy'] as const;

export function TodayPlanCard({
  plan,
}: {
  plan: TodayPlanView | { kind: 'no_plan_needed'; reason: string };
}) {
  if (plan.kind === 'no_plan_needed') {
    return (
      <div className="card--teal card">
        <span className="overline overline--onteal">Hôm nay</span>
        <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.4 }}>{plan.reason}</span>
      </div>
    );
  }
  const parts = [plan.mix.school, plan.mix.gapRepair, plan.mix.advanced, plan.mix.thinking];
  return (
    <div className="card--teal card" style={{ gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="overline overline--onteal">Hôm nay</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#a7e3da' }}>{plan.totalMinutes} phút</span>
      </div>
      <div className="mixbar">
        {parts.map((p, i) => (
          <div key={i} style={{ flex: p || 0.01, background: MIX_COLORS[i] }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px' }}>
        {MIX_LABELS.map((label, i) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: MIX_COLORS[i] }} />
            {label} {parts[i]}%
          </div>
        ))}
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {plan.steps.map((s) => (
          <li
            key={s.index}
            style={{
              display: 'flex',
              gap: 10,
              fontSize: 13,
              background: 'rgba(255,255,255,.12)',
              borderRadius: 12,
              padding: '9px 11px',
            }}
          >
            <b>{s.index}.</b>
            <span style={{ flex: 1 }}>
              {s.title} <span style={{ color: '#cdeae6' }}>· {s.minutes}′</span>
            </span>
          </li>
        ))}
      </ol>
      <button className="cta cta--onteal" style={{ marginTop: 4 }}>
        Bắt đầu dạy cùng con
      </button>
    </div>
  );
}

export function AttentionCard({ items }: { items: ParentHomeView['attention'] }) {
  if (items.length === 0) return null;
  const top = items[0]!;
  return (
    <div className="card card--attention">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--c-attention-dot)' }} />
        <span className="overline overline--attention">Cần chú ý</span>
      </div>
      <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.4, color: 'var(--c-attention-heading)' }}>
        {top.title}
      </span>
      <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--c-attention-body)' }}>{top.note}</span>
      {top.gapId ? (
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text-faint)' }}>Chi tiết đang hoàn thiện</span>
      ) : null}
      {items.slice(1).map((it) => (
        <span key={it.title} style={{ fontSize: 12.5, color: 'var(--c-attention-body)' }}>
          • {it.title}
        </span>
      ))}
    </div>
  );
}

export function InsightsRow({
  progressInsights: insights,
  thinkingChallenge: challenge,
}: Pick<ParentHomeView, 'progressInsights' | 'thinkingChallenge'>) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div className="card" style={{ flex: 1, gap: 5, padding: 14 }}>
        <span className="overline" style={{ color: 'var(--c-text-faint)' }}>
          Tiến bộ
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.4, color: 'var(--c-text-heading)' }}>
          {insights[0] ?? 'Con đang theo sát chương trình.'}
        </span>
      </div>
      <div className="card" style={{ flex: 1, gap: 5, padding: 14 }}>
        <span className="overline" style={{ color: 'var(--c-text-faint)' }}>
          Thử thách
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.4, color: 'var(--c-text-heading)' }}>
          {challenge?.title ?? 'Không có hôm nay'}
        </span>
      </div>
    </div>
  );
}

export function ProgressRow({ row }: { row: SkillProgressRow }) {
  return (
    <div className="progressrow">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text-heading)', minWidth: 0, flex: 1 }}>
          {row.name}
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: STATUS_COLOR[row.status],
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {STATUS_TEXT[row.status]}
        </span>
      </div>
      <div className="progressrow__track">
        <div
          className="progressrow__fill"
          style={{
            width: `${row.currentPercent}%`,
            background: row.status.startsWith('trên') || row.status.startsWith('đúng') ? 'var(--c-positive-bar)' : 'var(--c-unstable-bar)',
          }}
        />
        <span className="progressrow__target" style={{ left: `${row.targetPercent}%` }} />
      </div>
    </div>
  );
}

export function ParentNav({
  childId,
  active,
}: {
  childId: string;
  active: 'home' | 'progress' | 'practice' | 'profile' | 'connect';
}) {
  const base = `/be/${childId}`;
  const items: { key: typeof active; label: string; glyph: string; href: string }[] = [
    { key: 'home', label: 'Hôm nay', glyph: '◉', href: base },
    { key: 'progress', label: 'Tiến độ', glyph: '◔', href: `${base}/tien-do` },
    { key: 'practice', label: 'Bài tập', glyph: '⌗', href: `${base}/bai-tap` },
    { key: 'profile', label: 'Hồ sơ con', glyph: '◍', href: `${base}/ho-so` },
    { key: 'connect', label: 'Kết nối', glyph: '⇄', href: `${base}/ket-noi` },
  ];
  return (
    <nav className="bottomnav">
      {items.map((it) => (
        <a key={it.key} href={it.href} className="bottomnav__item" data-active={it.key === active}>
          <span style={{ fontSize: 19 }}>{it.glyph}</span>
          {it.label}
        </a>
      ))}
    </nav>
  );
}

export function Screen({ children, nav }: { children: ReactNode; nav: ReactNode }) {
  return (
    <div className="screen">
      <div className="screen__body">{children}</div>
      {nav}
    </div>
  );
}
