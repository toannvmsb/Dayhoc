import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useChild } from '@/child';
import { ParentNav } from '@/nav';
import { theme } from '@/theme';
import { Body, Button, Card, ErrorNote, Field, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { errText, useClient, useQuery } from '@/useApi';
import type { ExamDiagnosis, ExamListItem, RevisionMap } from '@/types';

const SCORES = [
  { label: 'Sai', value: 0 },
  { label: 'Một phần', value: 0.5 },
  { label: 'Đúng', value: 1 },
];

export default function ExamsScreen() {
  const { childId } = useChild();
  const api = useClient('PARENT');
  const list = useQuery<ExamListItem[]>(() => api.get(`/children/${childId}/exams`), [childId]);

  const [date, setDate] = useState('');
  const [subject, setSubject] = useState('Toán');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [open, setOpen] = useState<{ map: RevisionMap; diagnosis: ExamDiagnosis | null } | null>(null);
  const [marks, setMarks] = useState<Record<string, number>>({});

  const create = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setErr('Nhập ngày dạng YYYY-MM-DD.');
      return;
    }
    setBusy(true);
    setErr(undefined);
    try {
      await api.post(`/children/${childId}/exams`, { examDate: date, subject });
      setDate('');
      list.reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const openExam = async (id: string) => {
    setBusy(true);
    try {
      const map = await api.get<RevisionMap>(`/children/${childId}/exams/${id}/revision-map`);
      const diagnosis = await api.get<ExamDiagnosis | null>(`/children/${childId}/exams/${id}/diagnosis`);
      setOpen({ map, diagnosis });
      setMarks(Object.fromEntries(map.items.map((it) => [it.skillId, 1])));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const record = async () => {
    if (!open) return;
    setBusy(true);
    try {
      const diag = await api.post<ExamDiagnosis>(
        `/children/${childId}/exams/${open.map.examId}/result`,
        {
          outcomes: open.map.items.map((it, i) => ({
            questionRef: `q${i + 1}`,
            skillId: it.skillId,
            awardedScore: marks[it.skillId] ?? 1,
          })),
        },
      );
      setOpen({ ...open, diagnosis: diag });
      list.reload();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (open) {
    const { map, diagnosis } = open;
    return (
      <Screen>
        <Overline>
          {map.subject} · {map.examDate} · còn {map.dayCountdown} ngày
        </Overline>
        <H1>Bản đồ ôn tập</H1>
        <Card>
          <Overline>Ưu tiên ôn · {map.dailyMinutes} phút/ngày</Overline>
          {map.items.map((it, i) => (
            <View key={it.skillId} style={{ gap: 2 }}>
              <Text style={{ fontSize: 14, fontFamily: theme.font.bold, color: theme.color.textHeading }}>
                {i + 1}. {it.name}
              </Text>
              <Muted>{it.reason}</Muted>
            </View>
          ))}
        </Card>

        {diagnosis ? (
          <Card>
            <Overline>Chẩn đoán — đạt {diagnosis.totalAwardedPercent}%</Overline>
            {diagnosis.byCategory.map((c) => (
              <Body key={c.category}>
                {c.categoryLabel}: mất {c.lostPoints} điểm
              </Body>
            ))}
            {diagnosis.lostPoints.map((lp, i) => (
              <Muted key={i}>
                • {lp.skillName} — {lp.categoryLabel}: {lp.note}
              </Muted>
            ))}
          </Card>
        ) : (
          <Card>
            <Overline>Nhập kết quả từng phần</Overline>
            {map.items.map((it) => (
              <View key={it.skillId} style={{ gap: 4 }}>
                <Body>{it.name}</Body>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {SCORES.map((s) => (
                    <Pressable
                      key={s.label}
                      onPress={() => setMarks((m) => ({ ...m, [it.skillId]: s.value }))}
                      style={{
                        flex: 1,
                        paddingVertical: 7,
                        alignItems: 'center',
                        borderRadius: theme.radius.sm,
                        borderWidth: 1,
                        borderColor: marks[it.skillId] === s.value ? theme.color.primary : theme.color.border,
                        backgroundColor:
                          marks[it.skillId] === s.value ? theme.color.primaryTint : theme.color.surface,
                      }}
                    >
                      <Muted>{s.label}</Muted>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
            {err && <ErrorNote message={err} />}
            <Button label="Xem chẩn đoán" onPress={record} loading={busy} />
          </Card>
        )}
        <Button label="Quay lại" tone="ghost" onPress={() => setOpen(null)} />
      </Screen>
    );
  }

  return (
    <Screen nav={<ParentNav />} edges={['bottom']}>
      <H1>Kiểm tra &amp; ôn thi</H1>
      <Card>
        <Overline>Khai báo kỳ kiểm tra</Overline>
        <Field label="Ngày (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2027-05-15" />
        <Field label="Môn" value={subject} onChangeText={setSubject} />
        {err && <ErrorNote message={err} />}
        <Button label="Tạo bản đồ ôn tập" onPress={create} loading={busy} />
      </Card>

      {list.loading && <Loading />}
      {(list.data ?? []).map((e) => (
        <Pressable key={e.id} onPress={() => openExam(e.id)}>
          <Card>
            <Body>
              {e.subject} · {e.examDate}
            </Body>
            <Muted>{e.hasResult ? 'Đã có kết quả' : 'Bản đồ ôn tập'}</Muted>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
