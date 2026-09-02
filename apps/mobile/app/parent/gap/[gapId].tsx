import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useChild } from '@/child';
import { theme } from '@/theme';
import { Body, Button, Card, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import type { GapDetail } from '@/types';

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
          <Overline>{q.data.priorityLabel} · {q.data.lifecycleLabel}</Overline>
          <H1>{q.data.title}</H1>

          <Card>
            <Overline>Vì sao DạyZi nghĩ vậy</Overline>
            {q.data.whyAppThinks.map((w, i) => (
              <Body key={i}>{w}</Body>
            ))}
          </Card>

          {q.data.affects.length > 0 && (
            <Card>
              <Overline>Ảnh hưởng tới</Overline>
              {q.data.affects.map((a, i) => (
                <Body key={i}>• {a}</Body>
              ))}
            </Card>
          )}

          <Card>
            <Overline>Tiến trình khắc phục</Overline>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {q.data.lifecycleStep.map((s, i) => (
                <View
                  key={i}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 999,
                    backgroundColor:
                      s.state === 'current'
                        ? theme.color.primaryTint
                        : s.state === 'done'
                          ? theme.color.mintBg
                          : theme.color.surfaceRaised,
                  }}
                >
                  <Muted>{s.label}</Muted>
                </View>
              ))}
            </View>
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
