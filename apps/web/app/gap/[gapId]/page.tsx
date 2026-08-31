import { asChildId, asSkillId, type Evidence } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { buildLearningContext } from '@copilot/learning-context';
import { buildDailyPlan } from '@copilot/planning';
import { buildParentGapDetail, type ParentViewInput } from '@copilot/projections';
import { BottomNav, Screen } from '../../components';

// Rebuild the same demo scene and pick out one gap (server component).
function gapDetail(gapId: string) {
  const kb = loadKnowledgeBase();
  const CHILD = asChildId('demo_minh_anh');
  const AS_OF = new Date('2026-08-31T09:00:00Z');
  const at = (d: number) => new Date(AS_OF.getTime() - d * 86_400_000).toISOString();
  const mk = (i: number, s: string, d: number, c: boolean, x: Partial<Evidence> = {}): Evidence => ({
    id: `ev_${i}` as Evidence['id'],
    childId: CHILD,
    source: 'app_practice',
    occurredAt: at(d),
    recordedAt: at(d),
    skillId: asSkillId(s),
    result: { correct: c },
    confidenceTier: 'B',
    provenance: 'manual',
    ...x,
  });
  const evidence = [
    mk(7, 'M4.FRAC.EQUIVALENT', 24, true, { confidenceTier: 'A' }),
    mk(8, 'M4.FRAC.COMMON_DENOM', 10, false, { reasoningQuality: 'weak', source: 'school_homework', provenance: 'scan' }),
    mk(9, 'M4.FRAC.COMMON_DENOM', 6, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
    mk(10, 'M4.FRAC.COMMON_DENOM', 2, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
  ];
  const twin = buildLearningTwin({ childId: CHILD, gradeContext: 7, evidence, knowledgeBase: kb, asOf: AS_OF });
  const gaps = runGapEngine({ childId: CHILD, gradeContext: 7, twin, evidence, knowledgeBase: kb, parentGoal: 'kha_gioi', asOf: AS_OF });
  const context = buildLearningContext({ childId: CHILD, gradeContext: 7, evidence, teacherContributions: [], knowledgeBase: kb, asOf: AS_OF });
  const plan = buildDailyPlan({ childId: CHILD, planDate: '2026-08-31', availableMinutes: 25, twin, gaps, context, knowledgeBase: kb, asOf: AS_OF });
  const viewInput: ParentViewInput = { profile: { childId: CHILD as string, displayName: 'Minh Anh', schoolGrade: 7, schoolContext: 'Kết nối tri thức' }, twin, gaps, context, plan, knowledgeBase: kb };
  const chosen = gaps.gaps.find((g) => g.id === gapId) ?? gaps.gaps.find((g) => g.type !== 'careless_error');
  return chosen ? buildParentGapDetail(viewInput, chosen.id) : null;
}

const PRIORITY_TEXT: Record<string, string> = {
  ưu_tiên_cao: 'Ưu tiên cao',
  ưu_tiên_trung_bình: 'Ưu tiên trung bình',
  ưu_tiên_thấp: 'Ưu tiên thấp',
};

export default function GapDetailPage({ params }: { params: { gapId: string } }) {
  const d = gapDetail(params.gapId);
  if (!d) {
    return (
      <Screen nav={<BottomNav active="progress" />}>
        <p>Không tìm thấy điểm cần củng cố.</p>
      </Screen>
    );
  }
  return (
    <Screen nav={<BottomNav active="progress" />}>
      <div className="card card--attention">
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="chip" style={{ background: 'var(--c-attention-icon-bg)', color: 'var(--c-attention-text)', fontWeight: 800 }}>
            {PRIORITY_TEXT[d.priorityLabel]}
          </span>
          <span className="chip" style={{ background: '#fff', color: 'var(--c-attention-body)', fontWeight: 700 }}>
            {d.lifecycleLabel}
          </span>
        </div>
        <span style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.3, color: 'var(--c-attention-heading)' }}>{d.title}</span>
      </div>

      <div className="card">
        <span className="overline">Vì sao app nghĩ vậy?</span>
        {d.whyAppThinks.map((w, i) => (
          <div key={i} style={{ display: 'flex', gap: 10 }}>
            <span style={{ color: 'var(--c-primary)' }}>•</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--c-text-body-strong)' }}>{w}</span>
          </div>
        ))}
      </div>

      {d.affects.length > 0 && (
        <div className="card">
          <span className="overline">Ảnh hưởng tới</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {d.affects.map((a) => (
              <span key={a} className="chip" style={{ background: 'var(--c-primary-tint)', color: 'var(--c-on-primary-tint)' }}>
                {a}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <span className="overline" style={{ color: 'var(--c-text-faint)' }}>
          Diễn biến
        </span>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
          {d.lifecycleStep.map((s, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  width: s.state === 'current' ? 13 : 11,
                  height: s.state === 'current' ? 13 : 11,
                  borderRadius: '50%',
                  background: s.state === 'todo' ? 'var(--c-border)' : '#fff',
                  border: s.state === 'todo' ? 'none' : '3px solid var(--c-primary)',
                  boxSizing: 'border-box',
                }}
              />
              <span style={{ fontSize: 10.5, fontWeight: s.state === 'current' ? 800 : 600, textAlign: 'center', color: s.state === 'todo' ? 'var(--c-text-faint)' : 'var(--c-primary-strong)' }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {d.prescription && (
        <div className="card--teal card">
          <span className="overline overline--onteal">AI đề xuất — bố mẹ chọn</span>
          <span style={{ fontSize: 19, fontWeight: 800 }}>{d.prescription.summary}</span>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: '#cdeae6' }}>{d.prescription.rationale}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            {d.prescription.options.map((o, i) => (
              <div
                key={o.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '10px 13px',
                  borderRadius: 14,
                  background: i === 0 ? '#fff' : 'rgba(255,255,255,.12)',
                  color: i === 0 ? 'var(--c-text-heading)' : '#fff',
                }}
              >
                <b>{o.label}</b>
                <span style={{ opacity: 0.8 }}>{o.detail}</span>
              </div>
            ))}
          </div>
          <button className="cta cta--onteal" style={{ marginTop: 6 }}>
            Thêm vào kế hoạch
          </button>
        </div>
      )}
    </Screen>
  );
}
