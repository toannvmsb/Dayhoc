import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { StudentNav } from '@/nav';
import { theme } from '@/theme';
import { Button, ErrorNote, Loading, Screen } from '@/ui';
import { errText, useClient, useQuery } from '@/useApi';
import { useReloadOnFocus } from '@/useReloadOnFocus';
import type { ChildToday } from '@/types';

/** Bigger, simpler visual language for child screens (docs/design/handoff
 * mobile-390.dc.html, "NHÓM 4"): larger text, one thing per screen, an
 * icon-tile per task instead of a plain text card. */
const KIND_ICON: Record<string, { glyph: string; bg: string; fg: string }> = {
  practice: { glyph: '✎', bg: theme.color.primaryTint, fg: theme.color.primaryStrong },
  review: { glyph: '◍', bg: theme.color.attentionBg, fg: theme.color.attentionHeading },
  challenge: { glyph: '◆', bg: theme.color.primaryTint, fg: theme.color.primaryStrong },
};

export default function StudentToday() {
  const api = useClient('STUDENT');
  const q = useQuery<ChildToday>(() => api.get('/student/today'), []);
  const me = useQuery<{ childId: string }>(() => api.get('/student/me'), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();

  // Refresh when the screen regains focus (e.g. coming back from the runner)
  // so a just-completed task shows as done.
  useReloadOnFocus(q.reload);

  const openTask = (assignmentId: string) => {
    if (busy) return;
    router.push({ pathname: '/run/[assignmentId]', params: { assignmentId } });
  };

  // Empty state: create a fresh practice session from the current plan.
  const startPractice = async () => {
    if (!me.data || busy) return;
    setBusy(true);
    setErr(undefined);
    try {
      const res = await api.post<{ assignmentIds: string[] }>(
        `/children/${me.data.childId}/practice`,
        { minutes: 15 },
      );
      if (res.assignmentIds[0]) {
        router.push({
          pathname: '/run/[assignmentId]',
          params: { assignmentId: res.assignmentIds[0] },
        });
      } else {
        setErr('Chưa tạo được bài luyện tập. Con thử lại sau nhé.');
      }
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen nav={<StudentNav />} edges={['bottom']} refreshing={q.loading} onRefresh={q.reload}>
      {q.loading && <Loading />}
      {q.error && <ErrorNote message={q.error} />}
      {q.data && (
        <>
          <View style={{ backgroundColor: theme.color.primary, margin: -18, marginBottom: 6, padding: 18, paddingBottom: 24, gap: 6 }}>
            <Text style={{ fontSize: 13.5, fontWeight: '600', color: '#BDE6E0' }}>Xin chào</Text>
            <Text style={{ fontSize: 27, fontWeight: '800', color: theme.color.onDark, letterSpacing: -0.3 }}>
              Chào {q.data.greetingName} 👋
            </Text>
            <Text style={{ fontSize: 14.5, lineHeight: 21, color: '#CDEAE6' }}>{q.data.summary}</Text>
          </View>

          <View style={{ gap: 12 }}>
            {err && <ErrorNote message={err} />}
            {q.data.tasks.length === 0 ? (
              <View style={{ padding: 18, backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, gap: 12 }}>
                <Text style={{ fontSize: 16, lineHeight: 23, color: theme.color.textHeading }}>
                  {q.data.doneCount > 0
                    ? 'Con có thể làm thêm một buổi luyện tập nếu muốn.'
                    : 'Nhấn để bắt đầu một buổi luyện tập.'}
                </Text>
                <Button
                  label={
                    busy
                      ? 'Đang mở bài…'
                      : q.data.doneCount > 0
                        ? 'Luyện thêm 15 phút'
                        : 'Bắt đầu luyện 15 phút'
                  }
                  onPress={startPractice}
                  loading={busy}
                  disabled={busy}
                />
              </View>
            ) : (
              q.data.tasks.map((t, i) => {
                const icon = KIND_ICON[t.kind] ?? KIND_ICON.practice!;
                return (
                  <Pressable key={t.assignmentId} onPress={() => openTask(t.assignmentId)}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 14,
                        padding: 18,
                        backgroundColor: theme.color.surface,
                        borderRadius: theme.radius.lg,
                        borderWidth: i === 0 ? 2 : 1,
                        borderColor: i === 0 ? theme.color.primary : theme.color.border,
                      }}
                    >
                      <View
                        style={{
                          width: 46,
                          height: 46,
                          borderRadius: 14,
                          backgroundColor: icon.bg,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ fontSize: 19, color: icon.fg }}>{icon.glyph}</Text>
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={{ fontSize: 17, fontWeight: '800', color: theme.color.textHeading }}>{t.title}</Text>
                        <Text style={{ fontSize: 13.5, color: theme.color.textMuted }}>{t.subtitle}</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })
            )}

            {q.data.totalCount > 0 && (
              <View style={{ marginTop: 6, padding: 18, backgroundColor: theme.color.surfaceRaised, borderRadius: theme.radius.lg, gap: 9 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '700', color: theme.color.textBody }}>Việc hôm nay</Text>
                  <Text style={{ fontSize: 13.5, fontWeight: '800', color: theme.color.textHeading }}>
                    {q.data.doneCount}/{q.data.totalCount}
                  </Text>
                </View>
                <View style={{ height: 10, borderRadius: 5, backgroundColor: theme.color.surface, overflow: 'hidden' }}>
                  <View
                    style={{
                      width: `${Math.max(4, Math.round((q.data.doneCount / q.data.totalCount) * 100))}%`,
                      height: '100%',
                      backgroundColor: theme.color.primary,
                    }}
                  />
                </View>
              </View>
            )}
          </View>

          {q.data.tasks.length > 0 && (
            <Button label="Bắt đầu" onPress={() => openTask(q.data!.tasks[0]!.assignmentId)} />
          )}
        </>
      )}
    </Screen>
  );
}
