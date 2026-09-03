import { useCallback, useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useAuth } from '@/auth';
import { useChild } from '@/child';
import { ParentNav } from '@/nav';
import { theme } from '@/theme';
import { Body, Button, Card, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import type { Child, ParentHome } from '@/types';

export default function ParentHomeScreen() {
  const { session } = useAuth();
  const { childId, setChildId, reconcile } = useChild();
  const api = useClient('PARENT');

  const children = useQuery<Child[]>(() => api.get('/children'), [session?.bearer]);

  useEffect(() => {
    if (children.data) reconcile(children.data.map((c) => c.childId));
  }, [children.data, reconcile]);

  const known = children.data?.some((c) => c.childId === childId) ? childId : null;
  const activeId = known ?? children.data?.[0]?.childId ?? null;
  const home = useQuery<ParentHome>(() => api.get(`/children/${activeId}/home`), [activeId]);

  useFocusEffect(
    useCallback(() => {
      children.reload();
      home.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeId]),
  );

  if (children.loading) return <Loading />;

  if (children.data && children.data.length === 0) {
    return (
      <Screen>
        <H1>Thêm con của bạn</H1>
        <Body>Chưa có hồ sơ con nào. Thêm con để xem hôm nay dạy gì.</Body>
        <Button label="Mở cài đặt" onPress={() => router.push('/parent/settings')} />
      </Screen>
    );
  }

  return (
    <Screen
      nav={<ParentNav />}
      edges={['bottom']}
      refreshing={home.loading}
      onRefresh={() => {
        children.reload();
        home.reload();
      }}
    >
      {(children.data?.length ?? 0) > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {children.data!.map((c) => {
              const on = c.childId === activeId;
              return (
                <Pressable
                  key={c.childId}
                  onPress={() => setChildId(c.childId)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 999,
                    backgroundColor: on ? theme.color.primary : theme.color.surface,
                    borderWidth: 1,
                    borderColor: on ? theme.color.primary : theme.color.border,
                  }}
                >
                  <Text
                    style={{ fontSize: 13, fontWeight: '700', color: on ? theme.color.onDark : theme.color.textBody }}
                  >
                    {c.displayName}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}

      {home.loading && <Loading />}
      {home.error && <ErrorNote message={home.error} />}
      {home.data && <HomeBody data={home.data} />}
    </Screen>
  );
}

function HomeBody({ data }: { data: ParentHome }) {
  const est =
    data.learningContext.status === 'ESTIMATED_FROM_CALENDAR' ||
    data.learningContext.status === 'OBSERVED_FROM_SCHOOLWORK';
  return (
    <>
      <View style={{ gap: 4 }}>
        <Overline>
          DạyZi · {data.child.displayName} · Lớp {data.child.schoolGrade}
        </Overline>
        <H1>Hôm nay dạy con gì?</H1>
      </View>

      <Card>
        <Overline>Bài đang học</Overline>
        <Body>{data.learningContext.headline}</Body>
        <Muted>{data.learningContext.statusLabel}</Muted>
        {est && <Muted>DạyZi đang ước tính theo tiến độ chương trình — bạn xác nhận giúp nhé.</Muted>}
      </Card>

      {data.todayPlan.kind === 'plan' ? (
        <Card>
          <Overline>Kế hoạch hôm nay · {data.todayPlan.totalMinutes} phút</Overline>
          {data.todayPlan.steps.map((s) => (
            <Body key={s.index}>
              {s.index + 1}. {s.title} — {s.minutes}′ ({s.bucketLabel})
            </Body>
          ))}
        </Card>
      ) : (
        <Card>
          <Body>{data.todayPlan.reason}</Body>
        </Card>
      )}

      <Button label="Bắt đầu luyện tập cùng con" onPress={() => router.push('/parent/practice')} />

      {data.attention.length > 0 && (
        <Card tone="attention">
          <Overline>Cần chú ý</Overline>
          <Body>{data.attention[0]!.title}</Body>
          <Muted>{data.attention[0]!.note}</Muted>
          {data.attention[0]!.gapId ? (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/parent/gap/[gapId]', params: { gapId: data.attention[0]!.gapId } })
              }
            >
              <Text style={{ color: theme.color.attentionHeading, fontWeight: '700', fontSize: 13 }}>
                Xem chi tiết &amp; cách dạy con ›
              </Text>
            </Pressable>
          ) : null}
        </Card>
      )}

      {data.progressInsights[0] ? (
        <Card>
          <Overline>Tiến bộ</Overline>
          <Body>{data.progressInsights[0]}</Body>
        </Card>
      ) : null}
    </>
  );
}
