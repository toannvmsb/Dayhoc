import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useChild } from '@/child';
import { ParentNav } from '@/nav';
import { theme } from '@/theme';
import { Card, Dot, ErrorNote, H1, Loading, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import { useReloadOnFocus } from '@/useReloadOnFocus';
import type { ParentProgress, SkillRow } from '@/types';

const STATUS: Record<string, string> = {
  trên_mức_mục_tiêu: 'Trên mức mục tiêu',
  đúng_mức_mục_tiêu: 'Đúng mức mục tiêu',
  đang_củng_cố: 'Đang củng cố',
  chưa_ổn_định: 'Chưa ổn định',
};
/** Statuses that read as "on track" (teal) vs "needs work" (amber) — same 2-way
 * split the Hướng 1A mockup uses for the status label + bar-fill color. */
const ON_TRACK = new Set(['trên_mức_mục_tiêu', 'đúng_mức_mục_tiêu']);

const TABS = [
  { key: 'knowledge', label: 'Kiến thức' },
  { key: 'problemTypes', label: 'Dạng bài' },
  { key: 'thinking', label: 'Tư duy' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function SkillBar({ row }: { row: SkillRow }) {
  const onTrack = ON_TRACK.has(row.status);
  const pct = Math.max(4, Math.min(100, row.currentPercent));
  const targetPct = Math.max(0, Math.min(100, row.targetPercent));
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: theme.color.textHeading }}>{row.name}</Text>
        <Text style={{ fontSize: 12, fontWeight: '700', color: onTrack ? theme.color.primaryStrong : theme.color.warn }}>
          {STATUS[row.status] ?? row.status}
        </Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.color.surfaceRaised, overflow: 'hidden' }}>
        <View
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: onTrack ? theme.color.primary : theme.color.warnFill,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: `${targetPct}%`,
            top: -3,
            width: 2,
            height: 14,
            backgroundColor: theme.color.textHeading,
          }}
        />
      </View>
    </View>
  );
}

function Axis({ rows }: { rows: SkillRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <Text style={{ fontSize: 13.5, color: theme.color.textMuted }}>Chưa có dữ liệu ở mục này.</Text>
      </Card>
    );
  }
  return (
    <Card>
      <View style={{ gap: 13 }}>
        {rows.map((r) => (
          <SkillBar key={r.skillId} row={r} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 5, borderRadius: 3, backgroundColor: theme.color.primary }} />
          <Text style={{ fontSize: 11.5, color: theme.color.textMuted }}>Hiện tại</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 2, height: 11, backgroundColor: theme.color.textHeading }} />
          <Text style={{ fontSize: 11.5, color: theme.color.textMuted }}>Mục tiêu</Text>
        </View>
      </View>
    </Card>
  );
}

export default function ParentProgressScreen() {
  const { childId } = useChild();
  const api = useClient('PARENT');
  const q = useQuery<ParentProgress>(() => api.get(`/children/${childId}/progress`), [childId]);
  useReloadOnFocus(q.reload);
  const [tab, setTab] = useState<TabKey>('knowledge');

  return (
    <Screen nav={<ParentNav />} edges={['bottom']} refreshing={q.loading} onRefresh={q.reload}>
      <H1>{q.data ? `Tiến bộ · ${q.data.child.displayName}` : 'Tiến bộ'}</H1>
      {q.loading && <Loading />}
      {q.error && <ErrorNote message={q.error} />}
      {q.data && (
        <>
          {q.data.frontierInsight ? (
            <View
              style={{
                flexDirection: 'row',
                gap: 10,
                padding: 16,
                backgroundColor: theme.color.primaryTint,
                borderRadius: theme.radius.lg,
              }}
            >
              <Text style={{ fontSize: 15 }}>◔</Text>
              <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 20, color: theme.color.textHeading }}>
                {q.data.frontierInsight}
              </Text>
            </View>
          ) : null}

          <View
            style={{
              flexDirection: 'row',
              padding: 4,
              backgroundColor: theme.color.surfaceRaised,
              borderRadius: 13,
            }}
          >
            {TABS.map((t) => {
              const on = t.key === tab;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setTab(t.key)}
                  style={{
                    flex: 1,
                    height: 38,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: on ? theme.color.surface : 'transparent',
                    borderRadius: 10,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: on ? '700' : '600', color: on ? theme.color.textHeading : theme.color.textMuted }}>
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Axis rows={q.data.axes[tab]} />

          {q.data.recentEvidence.length > 0 && (
            <Card>
              <Overline>Căn cứ gần đây</Overline>
              <View style={{ gap: 12 }}>
                {q.data.recentEvidence.map((e, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 11, alignItems: 'flex-start' }}>
                    <View style={{ marginTop: 5 }}>
                      <Dot color={i === 0 ? theme.color.primary : theme.color.textFaint} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 13.5, fontWeight: '600', color: theme.color.textHeading }}>
                        {e.label}
                      </Text>
                      <Text style={{ fontSize: 12, color: theme.color.textMuted }}>{e.detail}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
