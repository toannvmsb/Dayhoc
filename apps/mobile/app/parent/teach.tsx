import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useChild } from '@/child';
import { theme } from '@/theme';
import { Body, Card, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import type { TeachingPlan } from '@/types';

function Bullets({ items, dotColor }: { items: string[]; dotColor: string }) {
  return (
    <View style={{ gap: 8 }}>
      {items.map((b, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 9 }}>
          <Text style={{ color: dotColor, fontSize: 13 }}>•</Text>
          <Body>{b}</Body>
        </View>
      ))}
    </View>
  );
}

export default function TeachScreen() {
  const { gapId } = useLocalSearchParams<{ gapId?: string }>();
  const { childId } = useChild();
  const api = useClient('PARENT');
  const q = useQuery<TeachingPlan>(
    () => api.get(`/children/${childId}/teaching-plan`, { gapId: gapId ? String(gapId) : undefined }),
    [childId, gapId],
  );

  return (
    <Screen>
      {q.loading && <Loading />}
      {q.error && <ErrorNote message={q.error} />}
      {q.data && (
        <>
          <Overline>DạyZi hướng dẫn bạn dạy con · ~{q.data.minutes} phút</Overline>
          <H1>{q.data.skillName}</H1>

          <Card tone="primary">
            <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: '#A7E3DA' }}>
              MỤC TIÊU BUỔI NÀY
            </Text>
            <Text style={{ color: theme.color.onDark, fontSize: 17, fontWeight: '700', lineHeight: 23 }}>
              {q.data.focusLine}
            </Text>
          </Card>

          <Card>
            <Overline>Bản chất</Overline>
            <Body>{q.data.gapMeaning}</Body>
          </Card>

          <Card>
            <Overline>Trước khi bắt đầu</Overline>
            <Bullets items={q.data.beforeYouStart} dotColor={theme.color.primary} />
          </Card>

          {q.data.steps.map((s, i) => (
            <Card key={i}>
              <Overline>{s.title}</Overline>
              <Text style={{ fontSize: 14.5, fontWeight: '700', lineHeight: 21, color: theme.color.textHeading }}>
                “{s.say}”
              </Text>
              <Muted>{s.why}</Muted>
            </Card>
          ))}

          {q.data.workedExample && (
            <Card>
              <Overline>Ví dụ để bạn làm mẫu cho con</Overline>
              <Text style={{ fontSize: 14.5, fontWeight: '700', color: theme.color.textHeading }}>
                {q.data.workedExample.prompt}
              </Text>
              <View style={{ gap: 4, marginTop: 2 }}>
                {q.data.workedExample.walkthrough.map((w, i) => (
                  <Muted key={i}>
                    {i + 1}. {w}
                  </Muted>
                ))}
              </View>
              {q.data.workedExample.answer ? (
                <Text style={{ fontSize: 13.5, fontWeight: '700', color: theme.color.primaryStrong, marginTop: 4 }}>
                  Đáp số: {q.data.workedExample.answer}
                </Text>
              ) : null}
            </Card>
          )}

          <Card>
            <Overline>Kiểm tra con đã hiểu chưa</Overline>
            <Bullets items={q.data.checkUnderstanding} dotColor={theme.color.primary} />
          </Card>

          <Card tone="attention">
            <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: theme.color.attentionHeading }}>
              LỖI THƯỜNG GẶP
            </Text>
            <View style={{ gap: 8, marginTop: 2 }}>
              {q.data.commonMistakes.map((c, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 9 }}>
                  <Text style={{ color: '#D97706', fontSize: 13 }}>•</Text>
                  <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 19.5, color: theme.color.attentionHeading }}>
                    {c}
                  </Text>
                </View>
              ))}
            </View>
          </Card>

          <Card>
            <Overline>Khích lệ con</Overline>
            <Bullets items={q.data.praise} dotColor={theme.color.primary} />
          </Card>

          <Card>
            <Overline>Nếu con vẫn chưa hiểu</Overline>
            <Body>{q.data.ifStuck}</Body>
          </Card>
        </>
      )}
    </Screen>
  );
}
