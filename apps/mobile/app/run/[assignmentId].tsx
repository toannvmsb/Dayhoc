import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { theme } from '@/theme';
import { Body, Button, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import type { AssignmentDetail } from '@/types';

export default function Runner() {
  const { assignmentId } = useLocalSearchParams<{ assignmentId: string }>();
  const api = useClient();
  const detail = useQuery<AssignmentDetail>(() => api.get(`/assignments/${assignmentId}`), [assignmentId]);

  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  const items = detail.data?.items ?? [];
  const item = items[i];
  const promptText = useMemo(() => {
    const p = item?.prompt as { text?: string } | string | undefined;
    return typeof p === 'string' ? p : (p?.text ?? '');
  }, [item]);

  if (detail.loading) return <Loading />;
  if (detail.error) return <Screen><ErrorNote message={detail.error} /></Screen>;

  if (!item || done) {
    return (
      <Screen scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <H1>Xong rồi!</H1>
          <Body>DạyZi đã ghi nhận và sẽ cập nhật tiến độ của con.</Body>
          <Button label="Về trang chính" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const cur = answers[item.id] ?? '';
  const isLast = i === items.length - 1;

  const submit = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      await api.post(`/assignments/${assignmentId}/submit`, {
        answers: items.map((it) => ({ assignmentItemId: it.id, answer: (answers[it.id] ?? '').trim(), hintsUsed: 0 })),
      });
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không lưu được.');
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll={false}>
      <Overline>
        Câu {i + 1} / {items.length}
      </Overline>
      <Body>{promptText}</Body>

      {item.answerKind === 'choice' && item.options ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          {item.options.map((opt) => (
            <Pressable
              key={opt}
              onPress={() => setAnswers((a) => ({ ...a, [item.id]: opt }))}
              style={{
                padding: 14,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: cur === opt ? theme.color.primary : theme.color.border,
                backgroundColor: cur === opt ? theme.color.primaryTint : theme.color.surface,
              }}
            >
              <Body>{opt}</Body>
            </Pressable>
          ))}
        </View>
      ) : (
        <TextInput
          value={cur}
          onChangeText={(t) => setAnswers((a) => ({ ...a, [item.id]: t }))}
          placeholder="Câu trả lời của con…"
          placeholderTextColor={theme.color.textFaint}
          keyboardType={item.answerKind === 'numeric' ? 'numeric' : 'default'}
          style={{
            height: 56,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.color.border,
            paddingHorizontal: 16,
            fontSize: 18,
            marginTop: 8,
            color: theme.color.textHeading,
          }}
        />
      )}

      {item.hintCount > 0 && <Muted>Cần gợi ý? Hỏi con nghĩ theo hướng đơn giản hơn một chút.</Muted>}
      {err && <ErrorNote message={err} />}

      <View style={{ flex: 1 }} />
      <Button
        label={busy ? 'Đang lưu…' : isLast ? 'Nộp bài' : 'Câu tiếp theo'}
        loading={busy}
        disabled={!cur.trim()}
        onPress={() => {
          if (isLast) void submit();
          else setI((n) => n + 1);
        }}
      />
    </Screen>
  );
}
