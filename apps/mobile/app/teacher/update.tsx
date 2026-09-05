import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { TeacherNav } from '@/nav';
import { theme } from '@/theme';
import { Body, Button, Card, ErrorNote, Field, Loading, Muted, Overline, Screen } from '@/ui';
import { errText, useClient, useQuery } from '@/useApi';
import type { CurriculumProgram, OcrHomeworkResult, Subject, TeacherChildRow } from '@/types';

const TYPES = [
  { value: 'CURRENT_LESSON', label: 'Bài đang dạy' },
  { value: 'CURRICULUM_PROGRESS', label: 'Tiến độ chương trình' },
  { value: 'HOMEWORK', label: 'Bài tập về nhà' },
  { value: 'EXAM_NOTICE', label: 'Lịch kiểm tra' },
] as const;
type ContributionType = (typeof TYPES)[number]['value'];

/** CURRENT_LESSON / CURRICULUM_PROGRESS pick real SGK lessons instead of
 * typing — a ticked lesson maps server-side to its skill ids, sent as
 * `taughtSkillIds`. Free text stays for HOMEWORK / EXAM_NOTICE where there
 * is no fixed vocabulary to pick from. */
function CurriculumPicker({
  grade,
  selected,
  onToggle,
}: {
  grade: number;
  selected: Set<string>;
  onToggle: (lessonId: string, skillIds: string[]) => void;
}) {
  const api = useClient('TEACHER');
  const program = useQuery<CurriculumProgram>(
    () => api.get('/teacher/curriculum-program', { grade: String(grade) }),
    [grade],
  );
  const [expanded, setExpanded] = useState<number | null>(null);

  if (program.loading) return <Loading />;
  if (program.error) return <ErrorNote message={program.error} />;
  if (!program.data || program.data.chapters.length === 0) {
    return <Muted>Chưa có chương trình SGK cho khối lớp này.</Muted>;
  }

  return (
    <View style={{ gap: 6 }}>
      <Muted>{program.data.curriculum} · Năm học {program.data.academicYear}</Muted>
      {program.data.chapters.map((c) => {
        const open = expanded === c.chapter;
        const pickedInChapter = c.lessons.filter((l) => selected.has(l.lessonId)).length;
        return (
          <View key={c.chapter} style={{ borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.color.border, overflow: 'hidden' }}>
            <Pressable
              onPress={() => setExpanded(open ? null : c.chapter)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                padding: 12,
                backgroundColor: pickedInChapter > 0 ? theme.color.primaryTint : theme.color.surface,
              }}
            >
              <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '700', color: theme.color.textHeading }}>
                Chương {c.chapter} · {c.name}
              </Text>
              {pickedInChapter > 0 && (
                <Text style={{ fontSize: 12, fontWeight: '800', color: theme.color.primaryStrong }}>
                  Đã chọn {pickedInChapter}
                </Text>
              )}
              <Text style={{ fontSize: 13, color: theme.color.textFaint }}>{open ? '▲' : '▼'}</Text>
            </Pressable>
            {open && (
              <View style={{ padding: 8, gap: 4, backgroundColor: theme.color.bg }}>
                {c.lessons.map((l) => {
                  const on = selected.has(l.lessonId);
                  return (
                    <Pressable
                      key={l.lessonId}
                      onPress={() => onToggle(l.lessonId, l.skillIds)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        padding: 10,
                        borderRadius: theme.radius.sm,
                        backgroundColor: on ? theme.color.primaryTint : theme.color.surface,
                      }}
                    >
                      <View
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 6,
                          borderWidth: 2,
                          borderColor: on ? theme.color.primary : theme.color.border,
                          backgroundColor: on ? theme.color.primary : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {on && <Text style={{ color: theme.color.onDark, fontSize: 11, fontWeight: '800' }}>✓</Text>}
                      </View>
                      <Text style={{ flex: 1, fontSize: 13.5, color: theme.color.textBody }}>{l.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

export default function TeacherUpdate() {
  // Local to this screen — NOT the shared `useChild()` pref, which is the
  // PARENT workspace's remembered active child. A teacher's students are a
  // different set of childIds; reusing that global pref here would silently
  // overwrite a parent's selection on a device signed into both workspaces.
  const [childId, setChildId] = useState('');
  const api = useClient('TEACHER');
  const students = useQuery<TeacherChildRow[]>(() => api.get('/teacher/children'), []);
  const subjects = useQuery<Subject[]>(() => api.get('/subjects'), []);

  const [type, setType] = useState<ContributionType>('CURRENT_LESSON');
  const [subjectId, setSubjectId] = useState('');
  const [examDate, setExamDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [ok, setOk] = useState(false);

  // lessonId -> its skillIds, so submit can flatten+dedupe without re-fetching the program
  const [selectedLessons, setSelectedLessons] = useState<Record<string, string[]>>({});
  const [ocrBusy, setOcrBusy] = useState(false);

  const activeId = childId || students.data?.[0]?.childId || '';
  const activeSubjectId = subjectId || subjects.data?.[0]?.id || '';
  const activeGrade = students.data?.find((s) => s.childId === activeId)?.schoolGrade ?? 4;

  // switching contribution type or student starts the lesson picker fresh —
  // stale ticks from a different type/child would silently misreport
  useEffect(() => {
    setSelectedLessons({});
  }, [type, activeId]);

  const toggleLesson = (lessonId: string, skillIds: string[]) => {
    setSelectedLessons((s) => {
      const next = { ...s };
      if (next[lessonId]) delete next[lessonId];
      else next[lessonId] = skillIds;
      return next;
    });
  };
  const taughtSkillIds = useMemo(
    () => [...new Set(Object.values(selectedLessons).flat())],
    [selectedLessons],
  );
  const usesCurriculumPicker = type === 'CURRENT_LESSON' || type === 'CURRICULUM_PROGRESS';

  const runOcr = async (base64: string, mimeType: string) => {
    setOcrBusy(true);
    setErr(undefined);
    try {
      const res = await api.post<OcrHomeworkResult>(`/teacher/children/${activeId}/ocr-homework`, {
        mimeType,
        contentBase64: base64,
      });
      setNote((prev) => (prev ? `${prev}\n${res.text}` : res.text));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setOcrBusy(false);
    }
  };

  const captureHomeworkPhoto = async () => {
    setErr(undefined);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setErr('DạyZi cần quyền camera để chụp bài tập.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 });
    const asset = res.canceled ? undefined : res.assets[0];
    if (asset?.base64) await runOcr(asset.base64, asset.mimeType ?? 'image/jpeg');
  };

  const pickHomeworkPhoto = async () => {
    setErr(undefined);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setErr('DạyZi cần quyền truy cập ảnh.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, mediaTypes: ['images'] });
    const asset = res.canceled ? undefined : res.assets[0];
    if (asset?.base64) await runOcr(asset.base64, asset.mimeType ?? 'image/jpeg');
  };

  const submit = async () => {
    if (!activeId || !activeSubjectId) {
      setErr('Chọn học sinh và môn học.');
      return;
    }
    if (usesCurriculumPicker && taughtSkillIds.length === 0) {
      setErr('Chọn ít nhất một bài trong chương trình.');
      return;
    }
    setBusy(true);
    setErr(undefined);
    setOk(false);
    try {
      await api.post(`/teacher/children/${activeId}/contributions`, {
        subjectId: activeSubjectId,
        contributionType: type,
        ...(usesCurriculumPicker ? { taughtSkillIds } : {}),
        ...(type === 'EXAM_NOTICE' ? { examDate } : {}),
        ...(type === 'HOMEWORK' || type === 'EXAM_NOTICE' ? { note } : {}),
      });
      setOk(true);
      setNote('');
      setSelectedLessons({});
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen nav={<TeacherNav />} edges={['bottom']}>
      <View style={{ padding: 18, backgroundColor: theme.color.night, borderRadius: theme.radius.lg, gap: 8 }}>
        <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: 'rgba(255,255,255,.55)' }}>
          CẬP NHẬT HÔM NAY
        </Text>
        <Text style={{ fontSize: 18, fontWeight: '700', lineHeight: 25, color: theme.color.onDark }}>
          Cho phụ huynh biết hôm nay đã dạy gì
        </Text>
        <Text style={{ fontSize: 13, lineHeight: 19.5, color: 'rgba(255,255,255,.6)' }}>
          Khoảng 40 giây. Phụ huynh dùng thông tin này để dạy con buổi tối.
        </Text>
      </View>

      {students.loading && <Loading />}
      {(students.data ?? []).length === 0 && !students.loading && (
        <Muted>Chưa có học sinh nào được phụ huynh chấp thuận.</Muted>
      )}

      {(students.data?.length ?? 0) > 0 && (
        <Card>
          <Overline>Học sinh</Overline>
          <View style={{ gap: 6 }}>
            {students.data!.map((s) => {
              const on = s.childId === activeId;
              return (
                <Pressable
                  key={s.childId}
                  onPress={() => setChildId(s.childId)}
                  style={{
                    padding: 12,
                    borderRadius: theme.radius.sm,
                    borderWidth: 1,
                    borderColor: on ? theme.color.primary : theme.color.border,
                    backgroundColor: on ? theme.color.primaryTint : theme.color.surface,
                  }}
                >
                  <Body>{s.displayName}</Body>
                </Pressable>
              );
            })}
          </View>
        </Card>
      )}

      {(subjects.data?.length ?? 0) > 0 && (
        <Card>
          <Overline>Môn học</Overline>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {subjects.data!.map((s) => {
              const on = s.id === activeSubjectId;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setSubjectId(s.id)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: on ? theme.color.primary : theme.color.border,
                    backgroundColor: on ? theme.color.primaryTint : theme.color.surface,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: on ? theme.color.primaryStrong : theme.color.textBody }}>
                    {s.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      )}

      <Card>
        <Overline>Loại cập nhật</Overline>
        <View style={{ gap: 6 }}>
          {TYPES.map((t) => {
            const on = t.value === type;
            return (
              <Pressable
                key={t.value}
                onPress={() => setType(t.value)}
                style={{
                  padding: 12,
                  borderRadius: theme.radius.sm,
                  borderWidth: 1,
                  borderColor: on ? theme.color.primary : theme.color.border,
                  backgroundColor: on ? theme.color.primaryTint : theme.color.surface,
                }}
              >
                <Body>{t.label}</Body>
              </Pressable>
            );
          })}
        </View>

        {usesCurriculumPicker && activeId && (
          <>
            <Overline>Chọn bài trong SGK</Overline>
            <CurriculumPicker grade={activeGrade} selected={new Set(Object.keys(selectedLessons))} onToggle={toggleLesson} />
          </>
        )}

        {type === 'EXAM_NOTICE' && (
          <Field label="Ngày kiểm tra (YYYY-MM-DD)" value={examDate} onChangeText={setExamDate} placeholder="2027-05-15" />
        )}

        {type === 'HOMEWORK' && (
          <>
            <Overline>Chụp ảnh bài tập (tuỳ chọn)</Overline>
            <Muted>DạyZi đọc thử ảnh và điền vào ô bên dưới — bạn xem lại, sửa nếu cần trước khi gửi.</Muted>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button label="Chụp ảnh" onPress={captureHomeworkPhoto} loading={ocrBusy} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Chọn từ thư viện" tone="ghost" onPress={pickHomeworkPhoto} loading={ocrBusy} />
              </View>
            </View>
          </>
        )}

        {(type === 'HOMEWORK' || type === 'EXAM_NOTICE') && (
          <Field
            label={type === 'HOMEWORK' ? 'Mã / mô tả bài tập (phân tách bằng dấu phẩy)' : 'Phạm vi kiểm tra'}
            value={note}
            onChangeText={setNote}
          />
        )}

        {err && <ErrorNote message={err} />}
        {ok && <Muted>Đã gửi cập nhật cho phụ huynh.</Muted>}
        <Button label="Gửi cập nhật" onPress={submit} loading={busy} />
      </Card>
    </Screen>
  );
}
