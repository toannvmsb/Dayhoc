import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useChild } from '@/child';
import { theme } from '@/theme';
import { Body, Card, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import type { TeachingPlan } from '@/types';

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
          <Body>{q.data.focusLine}</Body>

          <Card tone="primary">
            <Text style={{ color: theme.color.onDark, fontWeight: '700' }}>Hiểu đúng vấn đề</Text>
            <Text style={{ color: theme.color.onDark, fontSize: 14, lineHeight: 20 }}>{q.data.gapMeaning}</Text>
          </Card>

          <Card>
            <Overline>Trước khi bắt đầu</Overline>
            {q.data.beforeYouStart.map((b, i) => (
              <Muted key={i}>• {b}</Muted>
            ))}
          </Card>

          {q.data.steps.map((s, i) => (
            <Card key={i}>
              <Text style={{ fontWeight: '800', color: theme.color.textHeading }}>{s.title}</Text>
              <View
                style={{ backgroundColor: theme.color.primaryTint, borderRadius: theme.radius.sm, padding: 10 }}
              >
                <Body>{s.say}</Body>
              </View>
              <Muted>Vì sao: {s.why}</Muted>
            </Card>
          ))}

          {q.data.workedExample && (
            <Card>
              <Overline>Ví dụ để bạn làm mẫu cho con</Overline>
              <Body>{q.data.workedExample.prompt}</Body>
              {q.data.workedExample.walkthrough.map((w, i) => (
                <Muted key={i}>
                  {i + 1}. {w}
                </Muted>
              ))}
              {q.data.workedExample.answer ? <Muted>Đáp số: {q.data.workedExample.answer}</Muted> : null}
            </Card>
          )}

          <Card>
            <Overline>Kiểm tra con đã hiểu chưa</Overline>
            {q.data.checkUnderstanding.map((c, i) => (
              <Muted key={i}>• {c}</Muted>
            ))}
          </Card>

          <Card>
            <Overline>Lỗi thường gặp</Overline>
            {q.data.commonMistakes.map((c, i) => (
              <Muted key={i}>• {c}</Muted>
            ))}
          </Card>

          <Card>
            <Overline>Khích lệ con</Overline>
            {q.data.praise.map((c, i) => (
              <Muted key={i}>• {c}</Muted>
            ))}
          </Card>

          <Card>
            <Body>Nếu con vẫn chưa hiểu: {q.data.ifStuck}</Body>
          </Card>
        </>
      )}
    </Screen>
  );
}
