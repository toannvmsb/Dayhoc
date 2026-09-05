import { useMemo, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { theme } from '@/theme';
import { Body, Button, Card, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { errText, useClient, useQuery } from '@/useApi';
import type { AssignmentDetail, PracticeSubmitResult } from '@/types';

/** The six-rung hint ladder (Math Core §13/§17) — orientation, guiding
 * question, a second hint, a simpler analogue, retry, then the full worked
 * solution. A question's `hints` array holds up to the first 5; the 6th
 * ("full_solution") is `workedSolution`, kept separate so it's visually and
 * behaviourally the "last resort" rung, not just another hint. */
const RUNG_LABEL = ['ĐỊNH HƯỚNG', 'CÂU HỎI DẪN', 'GỢI Ý THÊM', 'VÍ DỤ ĐƠN GIẢN HƠN', 'THỬ LẠI', 'LỜI GIẢI ĐẦY ĐỦ'];

function HintSheet({
  visible,
  onClose,
  revealed,
  onReveal,
  hints,
  hasWorkedSolution,
  solution,
  solutionLoading,
}: {
  visible: boolean;
  onClose: () => void;
  revealed: number;
  onReveal: () => void;
  hints: string[];
  hasWorkedSolution: boolean;
  solution: string | null;
  solutionLoading: boolean;
}) {
  const rungTexts = [...hints, ...(hasWorkedSolution ? [solution ?? ''] : [])];
  const lastIdx = rungTexts.length - 1;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(20,33,30,.35)' }} onPress={onClose} />
      <View
        style={{
          backgroundColor: theme.color.surface,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          padding: 20,
          paddingBottom: 30,
          gap: 12,
        }}
      >
        <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: theme.color.border, alignSelf: 'center' }} />
        <H1>Gợi ý cho con</H1>

        {rungTexts.map((text, idx) => {
          const done = idx < revealed;
          const isNext = idx === revealed;
          const locked = idx > revealed;
          return (
            <View
              key={idx}
              style={{
                flexDirection: 'row',
                gap: 13,
                padding: 16,
                backgroundColor: done ? theme.color.primaryTint : theme.color.bg,
                borderWidth: done ? 0 : 1,
                borderColor: theme.color.border,
                borderRadius: 18,
                opacity: locked ? 0.6 : 1,
              }}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 9,
                  backgroundColor: done ? theme.color.primary : theme.color.surfaceRaised,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '800', color: done ? theme.color.onDark : theme.color.textMuted }}>
                  {idx + 1}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 1, color: done ? theme.color.primaryStrong : theme.color.textFaint }}>
                  {RUNG_LABEL[idx] ?? ''}
                </Text>
                {done ? (
                  <Text style={{ fontSize: 15, lineHeight: 22, color: theme.color.textHeading }}>
                    {idx === lastIdx && solutionLoading ? 'Đang tải…' : text}
                  </Text>
                ) : (
                  <Text style={{ fontSize: 14.5, color: theme.color.textFaint }}>
                    {locked ? `Mở sau bước ${revealed + 1}` : 'Thử tự làm thêm một lượt trước khi mở nhé.'}
                  </Text>
                )}
              </View>
              {isNext && !(idx === lastIdx && solutionLoading) && (
                <Pressable onPress={onReveal} style={{ alignSelf: 'center' }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '800', color: theme.color.primary }}>Mở</Text>
                </Pressable>
              )}
            </View>
          );
        })}

        <Button label="Con thử lại" onPress={onClose} />
      </View>
    </Modal>
  );
}

export default function Runner() {
  const { assignmentId } = useLocalSearchParams<{ assignmentId: string }>();
  const api = useClient();
  const detail = useQuery<AssignmentDetail>(() => api.get(`/assignments/${assignmentId}`), [assignmentId]);

  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [outcome, setOutcome] = useState<PracticeSubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [hintsRevealed, setHintsRevealed] = useState<Record<string, number>>({});
  const [hintSheetOpen, setHintSheetOpen] = useState(false);
  const [solutions, setSolutions] = useState<Record<string, string>>({});
  const [solutionLoading, setSolutionLoading] = useState(false);

  const items = detail.data?.items ?? [];
  const item = items[i];
  const promptText = useMemo(() => {
    const p = item?.prompt as { text?: string } | string | undefined;
    return typeof p === 'string' ? p : (p?.text ?? '');
  }, [item]);

  if (detail.loading) return <Loading />;
  if (detail.error) return <Screen><ErrorNote message={detail.error} /></Screen>;

  if (!item || done) {
    const res = outcome?.results ?? [];
    const graded = res.filter((r) => r.correct !== null);
    const correctCount = graded.filter((r) => r.correct === true).length;
    const needReview = res.filter((r) => r.verificationLevel === 'AI_CROSSCHECK_REQUIRED').length;
    const allCorrect = graded.length > 0 && correctCount === graded.length;
    const numberOf = (id: string) => {
      const idx = items.findIndex((it) => it.id === id);
      return idx >= 0 ? idx + 1 : '?';
    };
    const textOf = (id: string) => {
      const p = items.find((it) => it.id === id)?.prompt as { text?: string } | string | undefined;
      return typeof p === 'string' ? p : (p?.text ?? '');
    };
    return (
      <Screen>
        <View
          style={{
            alignItems: 'center',
            gap: 10,
            padding: 26,
            backgroundColor: theme.color.primaryTint,
            borderRadius: theme.radius.lg,
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: theme.color.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 28, color: theme.color.onDark, fontWeight: '800' }}>
              {allCorrect ? '✓' : graded.length > 0 ? `${correctCount}/${graded.length}` : '✓'}
            </Text>
          </View>
          <H1>{graded.length > 0 ? `Con làm đúng ${correctCount}/${graded.length} câu` : 'Xong rồi!'}</H1>
        </View>

        {res.map((r) => {
          const childAnswer = (answers[r.assignmentItemId] ?? '').trim();
          const showCompare = r.correct !== true;
          return (
            <Card key={r.assignmentItemId}>
              <Overline>Câu {numberOf(r.assignmentItemId)}</Overline>
              {textOf(r.assignmentItemId) ? <Muted>{textOf(r.assignmentItemId)}</Muted> : null}
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: '700',
                  color:
                    r.correct === true
                      ? theme.color.primaryStrong
                      : r.correct === false
                        ? theme.color.warn
                        : theme.color.textHeading,
                }}
              >
                {r.correct === true ? '✓ Đúng' : r.correct === false ? '✗ Chưa đúng' : 'Cần xem lại lời giải cùng con'}
              </Text>
              {showCompare && (
                <View style={{ marginTop: 4, gap: 2 }}>
                  <Muted>Con trả lời: {childAnswer || '(bỏ trống)'}</Muted>
                  {r.correct === false && r.expectedAnswer ? (
                    <Muted>Đáp án đúng: {r.expectedAnswer}</Muted>
                  ) : null}
                </View>
              )}
            </Card>
          );
        })}

        {needReview > 0 && (
          <Muted>Câu tự luận DạyZi không tự chấm — bố mẹ xem lời giải và trao đổi với con.</Muted>
        )}
        <Muted>DạyZi đã ghi nhận và sẽ cập nhật tiến độ của con.</Muted>
        <Button label="Về trang chính" onPress={() => router.back()} />
      </Screen>
    );
  }

  const cur = answers[item.id] ?? '';
  const isLast = i === items.length - 1;
  const pct = items.length > 0 ? ((i + 1) / items.length) * 100 : 0;

  const submit = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      const res = await api.post<PracticeSubmitResult>(`/assignments/${assignmentId}/submit`, {
        answers: items.map((it) => ({
          assignmentItemId: it.id,
          answer: (answers[it.id] ?? '').trim(),
          hintsUsed: hintsRevealed[it.id] ?? 0,
        })),
      });
      setOutcome(res);
      setDone(true);
    } catch (e) {
      setErr(errText(e));
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.color.surfaceRaised, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: theme.color.primary }} />
        </View>
        <Text style={{ fontSize: 13.5, fontWeight: '800', color: theme.color.textHeading }}>
          {i + 1}/{items.length}
        </Text>
      </View>

      <Card>
        <Overline>Câu {i + 1}</Overline>
        <Text style={{ fontSize: 21, fontWeight: '700', lineHeight: 30, color: theme.color.textHeading }}>
          {promptText}
        </Text>
      </Card>

      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '700', color: theme.color.textBody }}>Câu trả lời của con</Text>

        {item.answerKind === 'choice' && item.options ? (
          <View style={{ gap: 8 }}>
            {item.options.map((opt) => (
              <Pressable
                key={opt}
                onPress={() => setAnswers((a) => ({ ...a, [item.id]: opt }))}
                style={{
                  padding: 16,
                  borderRadius: theme.radius.md,
                  borderWidth: cur === opt ? 2 : 1,
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
            placeholder="Nhập câu trả lời…"
            placeholderTextColor={theme.color.textFaint}
            keyboardType={item.answerKind === 'numeric' ? 'numeric' : 'default'}
            style={{
              height: 58,
              borderRadius: theme.radius.md,
              borderWidth: 2,
              borderColor: cur ? theme.color.primary : theme.color.border,
              paddingHorizontal: 18,
              fontSize: 19,
              fontWeight: '700',
              color: theme.color.textHeading,
              backgroundColor: theme.color.surface,
            }}
          />
        )}

        {item.answerKind !== 'choice' && (
          <Muted>
            {item.answerKind === 'numeric'
              ? 'Chỉ nhập số, ví dụ: 9'
              : item.answerKind === 'fraction'
                ? 'Nhập dạng phân số, ví dụ: 3/4'
                : 'Nhập đáp án ngắn gọn, đúng như cách viết trong bài.'}
          </Muted>
        )}
      </View>

      {item.hintCount > 0 && (
        <Pressable onPress={() => setHintSheetOpen(true)}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 16,
              backgroundColor: theme.color.attentionBg,
              borderWidth: 1,
              borderColor: theme.color.attentionBorder,
              borderRadius: theme.radius.lg,
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                backgroundColor: theme.color.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 17, color: theme.color.attentionHeading }}>?</Text>
            </View>
            <Text style={{ flex: 1, fontSize: 14.5, fontWeight: '700', color: theme.color.attentionHeading }}>
              Con cần gợi ý?
            </Text>
            <Text style={{ fontSize: 13, fontWeight: '800', color: theme.color.attentionHeading }}>Mở ›</Text>
          </View>
        </Pressable>
      )}
      {err && <ErrorNote message={err} />}

      {item.hintCount > 0 && (
        <HintSheet
          visible={hintSheetOpen}
          onClose={() => setHintSheetOpen(false)}
          revealed={hintsRevealed[item.id] ?? 0}
          hints={item.hints}
          hasWorkedSolution={item.hasWorkedSolution}
          solution={solutions[item.id] ?? null}
          solutionLoading={solutionLoading}
          onReveal={async () => {
            const cap = item.hints.length + (item.hasWorkedSolution ? 1 : 0);
            const nextRevealed = Math.min((hintsRevealed[item.id] ?? 0) + 1, cap);
            const revealingSolution = item.hasWorkedSolution && nextRevealed === cap && !solutions[item.id];
            setHintsRevealed((h) => ({ ...h, [item.id]: nextRevealed }));
            if (revealingSolution) {
              setSolutionLoading(true);
              try {
                const res = await api.get<{ solution: string | null }>(
                  `/assignments/${assignmentId}/items/${item.id}/solution`,
                );
                if (res.solution) setSolutions((s) => ({ ...s, [item.id]: res.solution! }));
              } catch {
                // best-effort — the sheet just shows an empty rung, not a crash
              } finally {
                setSolutionLoading(false);
              }
            }
          }}
        />
      )}

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
