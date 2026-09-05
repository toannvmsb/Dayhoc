import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useChild } from '@/child';
import { ParentNav } from '@/nav';
import { theme } from '@/theme';
import { Body, Button, Card, Chip, ErrorNote, Field, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { errText, useClient, useQuery } from '@/useApi';
import type { ExamDiagnosis, ExamListItem, RevisionMap } from '@/types';

const SCORES = [
  { label: 'Sai', value: 0 },
  { label: 'Một phần', value: 0.5 },
  { label: 'Đúng', value: 1 },
];

/** `band` is an ordinal tier (packages/revision/src/revision-plan.ts), not a
 * numeric score — mobile never receives the underlying priority number. The
 * bar widths below are a fixed, representative fill per tier (not a real
 * percentage), matching the Hướng 1A mockup's visual weight per tier. */
const BAND_META: Record<string, { label: string; color: string; textColor: string; fill: number }> = {
  ưu_tiên_cao: { label: 'Ưu tiên cao', color: theme.color.warnFill, textColor: theme.color.warn, fill: 35 },
  nhắc_lại: { label: 'Nhắc lại', color: theme.color.primary, textColor: theme.color.textMuted, fill: 65 },
  đã_ổn: { label: 'Đã ổn', color: theme.color.primary, textColor: theme.color.primaryStrong, fill: 85 },
};

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
  const [scopeChecked, setScopeChecked] = useState<Record<string, boolean>>({});

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
      setScopeChecked(Object.fromEntries(map.items.map((it) => [it.skillId, true])));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmScope = async () => {
    if (!open) return;
    setBusy(true);
    setErr(undefined);
    try {
      const skillIds = open.map.items.map((it) => it.skillId).filter((id) => scopeChecked[id]);
      await api.post(`/children/${childId}/exams/${open.map.examId}/scope`, { skillIds });
      setOpen({ ...open, map: { ...open.map, scopeConfirmed: true, needsScopeConfirm: false } });
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
        <Card tone="primary">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <View
              style={{
                width: 84,
                height: 84,
                borderRadius: 42,
                backgroundColor: 'rgba(255,255,255,.16)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 30, fontWeight: '800', color: theme.color.onDark, lineHeight: 32 }}>
                {map.dayCountdown}
              </Text>
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#BDE6E0' }}>ngày</Text>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: '#A7E3DA' }}>
                KIỂM TRA {map.subject.toUpperCase()}
              </Text>
              <Text style={{ fontSize: 17, fontWeight: '800', color: theme.color.onDark }}>{map.examDate}</Text>
              <Text style={{ fontSize: 12.5, color: '#CDEAE6' }}>
                {map.scopeConfirmed ? 'Đã xác nhận phạm vi ôn' : 'Chế độ ôn tập đang bật'}
              </Text>
            </View>
          </View>
        </Card>

        {!map.scopeConfirmed && (
          <Card tone="attention">
            <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: theme.color.attentionHeading }}>
              CHƯA CÓ PHẠM VI CHÍNH THỨC
            </Text>
            <Text style={{ fontSize: 14, lineHeight: 21.5, color: theme.color.attentionText }}>
              App suy ra phạm vi từ những gì con đã học gần đây. Bố mẹ xác nhận giúp:
            </Text>
            <View style={{ gap: 7, marginTop: 4 }}>
              {map.items.map((it) => {
                const checked = !!scopeChecked[it.skillId];
                return (
                  <Pressable
                    key={it.skillId}
                    onPress={() => setScopeChecked((s) => ({ ...s, [it.skillId]: !s[it.skillId] }))}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      paddingHorizontal: 13,
                      paddingVertical: 11,
                      backgroundColor: theme.color.surface,
                      borderRadius: 12,
                    }}
                  >
                    <View
                      style={{
                        width: 19,
                        height: 19,
                        borderRadius: 6,
                        borderWidth: checked ? 0 : 2,
                        borderColor: theme.color.border,
                        backgroundColor: checked ? theme.color.primary : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {checked && <Text style={{ color: theme.color.onDark, fontSize: 11, fontWeight: '800' }}>✓</Text>}
                    </View>
                    <Text style={{ fontSize: 13.5, fontWeight: '600', color: theme.color.textHeading }}>{it.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            {err && <ErrorNote message={err} />}
            <Button label="Xác nhận phạm vi ôn" onPress={confirmScope} loading={busy} />
          </Card>
        )}

        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={styles.sectionTitle}>Ưu tiên ôn</Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: theme.color.textMuted }}>
              {map.dailyMinutes} phút/ngày
            </Text>
          </View>
          <View style={{ gap: 12, marginTop: 4 }}>
            {map.items.map((it, i) => {
              const meta = BAND_META[it.band] ?? BAND_META.nhắc_lại!;
              return (
                <View key={it.skillId} style={{ gap: 5 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={styles.itemTitle}>
                      {i + 1}. {it.name}
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: meta.textColor }}>{meta.label}</Text>
                  </View>
                  <View style={{ height: 7, borderRadius: 4, backgroundColor: theme.color.surfaceRaised, overflow: 'hidden' }}>
                    <View style={{ width: `${meta.fill}%`, height: '100%', backgroundColor: meta.color }} />
                  </View>
                  <Muted>{it.reason}</Muted>
                </View>
              );
            })}
          </View>
        </Card>

        {diagnosis ? (
          <Card>
            <Text style={styles.sectionTitle}>Chẩn đoán — đạt {diagnosis.totalAwardedPercent}%</Text>
            {diagnosis.byCategory.map((c) => (
              <Body key={c.category}>
                {c.categoryLabel}: mất {c.lostPoints} điểm
              </Body>
            ))}
            <View style={{ gap: 6, marginTop: 4 }}>
              {diagnosis.lostPoints.map((lp, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 9 }}>
                  <Text style={{ color: theme.color.warn, fontSize: 13 }}>•</Text>
                  <Muted>
                    {lp.skillName} — {lp.categoryLabel}: {lp.note}
                  </Muted>
                </View>
              ))}
            </View>
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
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Body>
                {e.subject} · {e.examDate}
              </Body>
              <Chip label={e.hasResult ? 'Đã có kết quả' : 'Bản đồ ôn tập'} tone={e.hasResult ? 'positive' : 'primary'} />
            </View>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 15, fontFamily: theme.font.bold, color: theme.color.textHeading },
  itemTitle: { fontSize: 14, fontFamily: theme.font.bold, color: theme.color.textHeading },
});
