import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useChild } from '@/child';
import { theme } from '@/theme';
import { Body, Button, Card, ErrorNote, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import type { GapDetail } from '@/types';

function Stepper({ steps }: { steps: GapDetail['lifecycleStep'] }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      {steps.map((s, i) => {
        const done = s.state === 'done';
        const current = s.state === 'current';
        return (
          <View key={s.label} style={{ flexDirection: 'row', alignItems: 'flex-start', flex: i === steps.length - 1 ? 0 : 1 }}>
            <View style={{ alignItems: 'center', gap: 5, width: 46 }}>
              <View
                style={
                  current
                    ? {
                        width: 13,
                        height: 13,
                        borderRadius: 7,
                        backgroundColor: theme.color.surface,
                        borderWidth: 3,
                        borderColor: theme.color.primary,
                      }
                    : {
                        width: 11,
                        height: 11,
                        borderRadius: 6,
                        backgroundColor: done ? theme.color.primary : theme.color.border,
                      }
                }
              />
              <Text
                style={{
                  fontSize: 10.5,
                  fontWeight: done || current ? '700' : '600',
                  color: done || current ? theme.color.primaryStrong : theme.color.textFaint,
                  textAlign: 'center',
                }}
              >
                {s.label}
              </Text>
            </View>
            {i < steps.length - 1 && (
              <View style={{ height: 2, flex: 1, marginTop: 5, backgroundColor: done ? theme.color.primary : theme.color.border }} />
            )}
          </View>
        );
      })}
    </View>
  );
}

export default function GapDetailScreen() {
  const { gapId } = useLocalSearchParams<{ gapId: string }>();
  const { childId } = useChild();
  const api = useClient('PARENT');
  const q = useQuery<GapDetail>(() => api.get(`/children/${childId}/gaps/${gapId}`), [childId, gapId]);

  return (
    <Screen>
      {q.loading && <Loading />}
      {q.error && <ErrorNote message={q.error} />}
      {q.data && (
        <>
          <Card tone="attention">
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ paddingHorizontal: 9, paddingVertical: 4, backgroundColor: theme.color.attentionChipBg, borderRadius: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: theme.color.attentionHeading }}>
                  {q.data.priorityLabel.toUpperCase()}
                </Text>
              </View>
              <View style={{ paddingHorizontal: 9, paddingVertical: 4, backgroundColor: theme.color.surface, borderRadius: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: theme.color.attentionText }}>
                  {q.data.lifecycleLabel}
                </Text>
              </View>
            </View>
            <Text style={{ fontSize: 21, fontWeight: '800', lineHeight: 27, color: theme.color.attentionHeading }}>
              {q.data.title}
            </Text>
          </Card>

          <Card>
            <Overline>Vì sao DạyZi nghĩ vậy</Overline>
            <View style={{ gap: 8 }}>
              {q.data.whyAppThinks.map((w, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
                  <Text style={{ color: theme.color.primary, fontSize: 13 }}>•</Text>
                  <Body>{w}</Body>
                </View>
              ))}
            </View>
          </Card>

          {q.data.affects.length > 0 && (
            <Card>
              <Overline>Ảnh hưởng tới</Overline>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {q.data.affects.map((a, i) => (
                  <View
                    key={i}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      backgroundColor: theme.color.primaryTint,
                      borderRadius: 11,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: theme.color.primaryStrong }}>{a}</Text>
                  </View>
                ))}
              </View>
            </Card>
          )}

          <Card>
            <Overline>Diễn biến</Overline>
            <Stepper steps={q.data.lifecycleStep} />
          </Card>

          {q.data.prescription && (
            <Card>
              <Overline>Kế hoạch luyện tập gợi ý</Overline>
              <Body>{q.data.prescription.summary}</Body>
              {q.data.prescription.perSession.map((p, i) => (
                <Muted key={i}>
                  {p.label}: {p.count}
                </Muted>
              ))}
            </Card>
          )}

          <Button
            label="DạyZi hướng dẫn bạn dạy con phần này"
            onPress={() => router.push({ pathname: '/parent/teach', params: { gapId: String(gapId) } })}
          />
        </>
      )}
    </Screen>
  );
}
