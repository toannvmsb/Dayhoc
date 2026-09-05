import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/auth';
import { useChild } from '@/child';
import { ParentNav } from '@/nav';
import { theme } from '@/theme';
import { Avatar, Body, Button, Card, Chip, Dot, ErrorNote, H1, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import { useReloadOnFocus } from '@/useReloadOnFocus';
import type { Child, ParentHome } from '@/types';

/** Fixed learning-mix buckets (packages/projections/src/shared.ts BUCKET_LABEL) → a
 * stable color per bucket, matching the Hướng 1A "HÔM NAY" segmented bar. */
const BUCKET_COLOR: Record<string, string> = {
  'Bài trên lớp': '#FFFFFF',
  'Củng cố': '#FFC46B',
  'Nâng cao': '#7FD1C4',
  'Tư duy': '#3E6E68',
};
const BUCKET_ORDER = ['Bài trên lớp', 'Củng cố', 'Nâng cao', 'Tư duy'];

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
  const home = useQuery<ParentHome>(
    () => (activeId ? api.get(`/children/${activeId}/home`) : Promise.resolve(undefined as never)),
    [activeId],
  );

  useReloadOnFocus(() => {
    children.reload();
    home.reload();
  });

  if (children.loading && !children.data) return <Loading />;

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
      {home.loading && <Loading />}
      {home.error && <ErrorNote message={home.error} />}
      {home.data && (
        <HomeBody
          data={home.data}
          siblings={(children.data?.length ?? 0) > 1 ? children.data! : null}
          activeId={activeId}
          onSwitch={setChildId}
        />
      )}
    </Screen>
  );
}

function HomeBody({
  data,
  siblings,
  activeId,
  onSwitch,
}: {
  data: ParentHome;
  siblings: Child[] | null;
  activeId: string | null;
  onSwitch: (id: string) => void;
}) {
  const est =
    data.learningContext.status === 'ESTIMATED_FROM_CALENDAR' ||
    data.learningContext.status === 'OBSERVED_FROM_SCHOOLWORK';
  const [switching, setSwitching] = useState(false);
  return (
    <>
      <H1>Hôm nay dạy con gì?</H1>

      <Card>
        <Pressable
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
          onPress={() => siblings && setSwitching((s: boolean) => !s)}
        >
          <Avatar label={data.child.displayName} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 15.5, fontWeight: '700', color: theme.color.textHeading }}>
              {data.child.displayName}
            </Text>
            <Muted>
              Lớp {data.child.schoolGrade} · {data.child.schoolContext}
            </Muted>
          </View>
          {siblings && (
            <Text style={{ fontSize: 12.5, fontWeight: '600', color: theme.color.primary }}>Đổi ›</Text>
          )}
        </Pressable>
        {switching && siblings && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {siblings.map((c) => {
                const on = c.childId === activeId;
                return (
                  <Pressable
                    key={c.childId}
                    onPress={() => {
                      onSwitch(c.childId);
                      setSwitching(false);
                    }}
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
      </Card>

      <Card>
        <Overline>Con đang học</Overline>
        <Text style={{ fontSize: 17, fontWeight: '700', lineHeight: 23, color: theme.color.textHeading }}>
          {data.learningContext.headline}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
          <Chip label={data.learningContext.statusLabel} />
          {est && <Chip label="Đang ước tính" tone="primary" />}
        </View>
      </Card>

      {data.todayPlan.kind === 'plan' ? (() => {
        const steps = data.todayPlan.steps;
        const minutesByBucket = new Map<string, number>();
        for (const s of steps) minutesByBucket.set(s.bucketLabel, (minutesByBucket.get(s.bucketLabel) ?? 0) + s.minutes);
        const buckets = BUCKET_ORDER.filter((b) => minutesByBucket.has(b));
        return (
        <Card tone="primary">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: '#A7E3DA' }}>HÔM NAY</Text>
            <Text style={{ fontSize: 12.5, fontWeight: '600', color: '#A7E3DA' }}>
              {data.todayPlan.totalMinutes} phút
            </Text>
          </View>

          <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 }}>
            {buckets.map((b) => (
              <View key={b} style={{ flex: minutesByBucket.get(b) ?? 1, backgroundColor: BUCKET_COLOR[b] }} />
            ))}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {buckets.map((b) => (
              <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: '45%' }}>
                <Dot color={BUCKET_COLOR[b]} size={9} />
                <Text style={{ fontSize: 12.5, fontWeight: '600', color: theme.color.onDark }}>
                  {b} {minutesByBucket.get(b)}′
                </Text>
              </View>
            ))}
          </View>

          <Pressable
            onPress={() => router.push('/parent/practice')}
            style={{
              height: 52,
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.onDark,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.color.primaryStrong, fontSize: 16, fontWeight: '800' }}>
              Bắt đầu dạy cùng con
            </Text>
          </Pressable>
        </Card>
        );
      })() : (
        <Card>
          <Body>{data.todayPlan.reason}</Body>
        </Card>
      )}

      {data.attention.length > 0 && (
        <Card tone="attention">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Dot />
            <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: theme.color.attentionHeading }}>
              CẦN CHÚ Ý
            </Text>
          </View>
          <Text style={{ fontSize: 15, fontWeight: '700', lineHeight: 21, color: theme.color.attentionHeading }}>
            {data.attention[0]!.title}
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 19.5, color: theme.color.attentionText }}>
            {data.attention[0]!.note}
          </Text>
          {data.attention[0]!.gapId ? (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/parent/gap/[gapId]', params: { gapId: data.attention[0]!.gapId } })
              }
            >
              <Text style={{ color: theme.color.primary, fontWeight: '700', fontSize: 13 }}>
                Xem chi tiết &amp; cách dạy con ›
              </Text>
            </Pressable>
          ) : null}
        </Card>
      )}

      {(data.progressInsights[0] || data.thinkingChallenge) && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {data.progressInsights[0] ? (
            <View style={{ flex: 1 }}>
              <Card>
                <Overline>Tiến bộ</Overline>
                <Text style={{ fontSize: 13.5, fontWeight: '600', lineHeight: 19, color: theme.color.textHeading }}>
                  {data.progressInsights[0]}
                </Text>
              </Card>
            </View>
          ) : null}
          {data.thinkingChallenge ? (
            <View style={{ flex: 1 }}>
              <Pressable onPress={() => data.thinkingChallenge!.available && router.push('/parent/practice')}>
                <Card>
                  <Overline>Thử thách</Overline>
                  <Text style={{ fontSize: 13.5, fontWeight: '600', lineHeight: 19, color: theme.color.textHeading }}>
                    {data.thinkingChallenge.title}
                    {data.thinkingChallenge.available ? ' · Giao cho con' : ''}
                  </Text>
                </Card>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
    </>
  );
}
