import { Text, View } from 'react-native';
import { useChild } from '@/child';
import { ParentNav } from '@/nav';
import { theme } from '@/theme';
import { Body, Card, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import type { ParentProgress, SkillRow } from '@/types';

const STATUS: Record<string, string> = {
  trên_mức_mục_tiêu: 'Trên mục tiêu',
  đúng_mức_mục_tiêu: 'Đúng mục tiêu',
  đang_củng_cố: 'Đang củng cố',
  chưa_ổn_định: 'Chưa ổn định',
};

function Axis({ title, rows }: { title: string; rows: SkillRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <Overline>{title}</Overline>
      {rows.map((r) => (
        <View key={r.skillId} style={{ gap: 3 }}>
          <Body>{r.name}</Body>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.color.surfaceRaised }}>
            <View
              style={{
                height: 6,
                borderRadius: 3,
                width: `${Math.max(4, Math.min(100, r.currentPercent))}%`,
                backgroundColor: theme.color.mint,
              }}
            />
          </View>
          <Muted>{STATUS[r.status] ?? r.status}</Muted>
        </View>
      ))}
    </Card>
  );
}

export default function ParentProgressScreen() {
  const { childId } = useChild();
  const api = useClient('PARENT');
  const q = useQuery<ParentProgress>(() => api.get(`/children/${childId}/progress`), [childId]);

  return (
    <Screen nav={<ParentNav />} edges={['bottom']}>
      <H1>Tiến độ</H1>
      {q.loading && <Loading />}
      {q.error && <ErrorNote message={q.error} />}
      {q.data && (
        <>
          {q.data.frontierInsight ? (
            <Card tone="primary">
              <Text style={{ color: theme.color.onDark, fontSize: 14, lineHeight: 20 }}>
                {q.data.frontierInsight}
              </Text>
            </Card>
          ) : null}
          <Axis title="Kiến thức" rows={q.data.axes.knowledge} />
          <Axis title="Dạng bài" rows={q.data.axes.problemTypes} />
          <Axis title="Tư duy" rows={q.data.axes.thinking} />
          {q.data.recentEvidence.length > 0 && (
            <Card>
              <Overline>Gần đây</Overline>
              {q.data.recentEvidence.map((e, i) => (
                <Muted key={i}>
                  {e.label}: {e.detail}
                </Muted>
              ))}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
