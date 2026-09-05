import { Text, View } from 'react-native';
import { useChild } from '@/child';
import { theme } from '@/theme';
import { Card, Dot, ErrorNote, H1, Loading, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import type { WeeklyReport } from '@/types';

const MIX_COLOR: Record<keyof WeeklyReport['nextWeekMix'], string> = {
  school: '#FFFFFF',
  gapRepair: '#FFC46B',
  advanced: '#7FD1C4',
  thinking: '#3E6E68',
};
const MIX_LABEL: Record<keyof WeeklyReport['nextWeekMix'], string> = {
  school: 'Bài trên lớp',
  gapRepair: 'Củng cố',
  advanced: 'Nâng cao',
  thinking: 'Tư duy',
};

export default function WeeklyReportScreen() {
  const { childId } = useChild();
  const api = useClient('PARENT');
  const q = useQuery<WeeklyReport>(() => api.get(`/children/${childId}/weekly-report`), [childId]);

  return (
    <Screen>
      {q.loading && <Loading />}
      {q.error && <ErrorNote message={q.error} />}
      {q.data && (
        <>
          <H1>{q.data.weekLabel}</H1>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            {q.data.stats.map((s, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  gap: 3,
                  padding: 15,
                  backgroundColor: s.highlight ? theme.color.primaryTint : theme.color.surface,
                  borderWidth: s.highlight ? 0 : 1,
                  borderColor: theme.color.border,
                  borderRadius: theme.radius.lg,
                }}
              >
                <Text style={{ fontSize: 25, fontWeight: '800', lineHeight: 28, color: s.highlight ? theme.color.primaryStrong : theme.color.textHeading }}>
                  {s.value}
                </Text>
                <Text style={{ fontSize: 12, lineHeight: 16.5, color: s.highlight ? theme.color.primaryStrong : theme.color.textMuted }}>
                  {s.label}
                </Text>
              </View>
            ))}
          </View>

          {q.data.progress.length > 0 && (
            <Card>
              <Overline>Tiến bộ trong tuần</Overline>
              <View style={{ gap: 10 }}>
                {q.data.progress.map((p, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
                    <Text style={{ color: theme.color.primary }}>↗</Text>
                    <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 20, color: theme.color.textHeading }}>{p}</Text>
                  </View>
                ))}
              </View>
            </Card>
          )}

          {q.data.needsFollowUp.length > 0 && (
            <Card tone="attention">
              <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: theme.color.attentionHeading }}>
                CẦN THEO TIẾP
              </Text>
              <View style={{ gap: 10, marginTop: 2 }}>
                {q.data.needsFollowUp.map((f, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
                    <Dot color="#D97706" size={7} />
                    <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 20, color: theme.color.attentionText }}>{f}</Text>
                  </View>
                ))}
              </View>
            </Card>
          )}

          <Card>
            <Overline>Đề xuất phân bổ tuần tới</Overline>
            <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 }}>
              {(Object.keys(q.data.nextWeekMix) as (keyof WeeklyReport['nextWeekMix'])[]).map((k) => (
                <View key={k} style={{ flex: q.data!.nextWeekMix[k] || 1, backgroundColor: MIX_COLOR[k] }} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {(Object.keys(q.data.nextWeekMix) as (keyof WeeklyReport['nextWeekMix'])[]).map((k) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Dot color={MIX_COLOR[k]} size={9} />
                  <Text style={{ fontSize: 12.5, color: theme.color.textBody }}>
                    {MIX_LABEL[k]} {q.data!.nextWeekMix[k]}%
                  </Text>
                </View>
              ))}
            </View>
            <Text style={{ fontSize: 12, lineHeight: 18, color: theme.color.textFaint, marginTop: 4 }}>
              {q.data.nextWeekNote}
            </Text>
          </Card>
        </>
      )}
    </Screen>
  );
}
