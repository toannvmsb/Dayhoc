import { useLocalSearchParams } from 'expo-router';
import { Body, Card, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
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
const BAND: Record<string, string> = { vững: 'Vững', đang_ổn_định: 'Đang ổn định', cần_củng_cố: 'Cần củng cố' };
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
          (perms.data?.codes ?? []).map((c) => <Body key={c}>• {PERM_LABEL[c] ?? c}</Body>)
        )}
      </Card>

      <Card>
        <Overline>Mức độ nắm bài</Overline>
        {(twin.data?.skills ?? []).length === 0 ? (
          <Muted>Bạn chưa được cấp quyền xem, hoặc chưa đủ dữ liệu.</Muted>
        ) : (
          (twin.data?.skills ?? []).map((s) => (
            <Body key={s.skillId}>
              {s.skillName ?? s.skillId} — {BAND[s.band] ?? s.band}
            </Body>
          ))
        )}
      </Card>

      {(gaps.data?.gaps ?? []).length > 0 && (
        <Card>
          <Overline>Điểm cần củng cố (phụ huynh chọn chia sẻ)</Overline>
          {(gaps.data?.gaps ?? []).map((g, i) => (
            <Body key={i}>
              • {g.skillName ?? g.skillId}
              {g.lifecycleState ? ` — ${LIFECYCLE[g.lifecycleState] ?? g.lifecycleState}` : ''}
            </Body>
          ))}
        </Card>
      )}
    </Screen>
  );
}
