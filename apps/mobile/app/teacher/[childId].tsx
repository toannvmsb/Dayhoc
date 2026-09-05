import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { theme } from '@/theme';
import { Card, Chip, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';

const PERM_LABEL: Record<string, string> = {
  VIEW_CLASS_CONTEXT: 'Xem bối cảnh lớp học',
  SUBMIT_CURRENT_LESSON: 'Cập nhật bài đang dạy',
  SUBMIT_HOMEWORK: 'Cập nhật bài tập về nhà',
  SUBMIT_EXAM_NOTICE: 'Báo lịch kiểm tra',
  VIEW_ASSIGNMENT_COMPLETION: 'Xem con đã hoàn thành bài giao chưa',
  VIEW_SELECTED_MASTERY: 'Xem mức độ nắm bài (đã chọn)',
  VIEW_SELECTED_GAPS: 'Xem điểm cần củng cố (đã chọn)',
  VIEW_LEARNING_TWIN_SUMMARY: 'Xem tóm tắt mức độ nắm bài',
};
const BAND: Record<string, { label: string; tone: 'positive' | 'primary' | 'neutral' }> = {
  vững: { label: 'Vững', tone: 'positive' },
  đang_ổn_định: { label: 'Đang ổn định', tone: 'primary' },
  cần_củng_cố: { label: 'Cần củng cố', tone: 'neutral' },
};
const LIFECYCLE: Record<string, string> = {
  DETECTED: 'Mới phát hiện',
  CONFIRMED: 'Đã xác nhận',
  TREATING: 'Đang củng cố',
  IMPROVING: 'Đang tiến bộ',
  CLOSED: 'Đã khắc phục',
  MONITORING: 'Đang theo dõi',
};

type Perms = { codes: string[] };
type Twin = { skills: { skillId: string; skillName?: string; band: string }[] };
type Gaps = { gaps: { skillId: string; skillName?: string; lifecycleState?: string }[] };

export default function TeacherChildDetail() {
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const api = useClient('TEACHER');

  const perms = useQuery<Perms>(() => api.get(`/teacher/children/${childId}/permissions`), [childId]);
  const twin = useQuery<Twin>(
    () => api.get<Twin>(`/teacher/children/${childId}/twin`).catch(() => ({ skills: [] })),
    [childId],
  );
  const gaps = useQuery<Gaps>(
    () => api.get<Gaps>(`/teacher/children/${childId}/gaps`).catch(() => ({ gaps: [] })),
    [childId],
  );

  return (
    <Screen>
      <H1>Chi tiết học sinh</H1>
      {perms.loading && <Loading />}
      {perms.error && <ErrorNote message={perms.error} />}

      <Card>
        <Overline>Quyền phụ huynh đã cấp</Overline>
        {(perms.data?.codes ?? []).length === 0 ? (
          <Muted>Phụ huynh chưa cấp quyền xem thông tin học tập cá nhân.</Muted>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {(perms.data?.codes ?? []).map((c) => (
              <Chip key={c} label={PERM_LABEL[c] ?? c} tone="primary" />
            ))}
          </View>
        )}
      </Card>

      <Card>
        <Overline>Mức độ nắm bài</Overline>
        {(twin.data?.skills ?? []).length === 0 ? (
          <Muted>Bạn chưa được cấp quyền xem, hoặc chưa đủ dữ liệu.</Muted>
        ) : (
          <View style={{ gap: 9 }}>
            {(twin.data?.skills ?? []).map((s) => {
              const b = BAND[s.band];
              return (
                <View key={s.skillId} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: theme.color.textHeading }}>
                    {s.skillName ?? s.skillId}
                  </Text>
                  <Chip label={b?.label ?? s.band} tone={b?.tone ?? 'neutral'} />
                </View>
              );
            })}
          </View>
        )}
      </Card>

      {(gaps.data?.gaps ?? []).length > 0 && (
        <Card tone="attention">
          <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: theme.color.attentionHeading }}>
            ĐIỂM CẦN CỦNG CỐ (PHỤ HUYNH CHỌN CHIA SẺ)
          </Text>
          <View style={{ gap: 8, marginTop: 2 }}>
            {(gaps.data?.gaps ?? []).map((g, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 9 }}>
                <Text style={{ color: theme.color.warn, fontSize: 13 }}>•</Text>
                <Text style={{ flex: 1, fontSize: 13.5, color: theme.color.attentionText }}>
                  {g.skillName ?? g.skillId}
                  {g.lifecycleState ? ` — ${LIFECYCLE[g.lifecycleState] ?? g.lifecycleState}` : ''}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      )}
    </Screen>
  );
}
