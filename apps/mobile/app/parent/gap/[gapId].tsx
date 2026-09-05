import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useChild } from '@/child';
import { theme } from '@/theme';
import { Body, Button, Card, ErrorNote, Loading, Muted, Overline, Screen } from '@/ui';
import { useClient, useQuery } from '@/useApi';
import type { GapDetail } from '@/types';

function Stepper({ steps }: { steps: GapDetail['lifecycleStep'] }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      {steps.map((s, i) => {
        const done = s.state === 'done';
        const current = s.state === 'current';
        return (
          <View key={s.label} style={{ flexDirection: 'row', alignItems: 'flex-start', flex: i === steps.length - 1 ? 0 : 1 }}>
            <View style={{ alignItems: 'center', gap: 5, width: 46 }}>
              <View
                style={
                  current
                    ? {
                        width: 13,
                        height: 13,
                        borderRadius: 7,
                        backgroundColor: theme.color.surface,
                        borderWidth: 3,
                        borderColor: theme.color.primary,
                      }
                    : {
                        width: 11,
                        height: 11,
                        borderRadius: 6,
                        backgroundColor: done ? theme.color.primary : theme.color.border,
                      }
                }
              />
              <Text
                style={{
                  fontSize: 10.5,
                  fontWeight: done || current ? '700' : '600',
                  color: done || current ? theme.color.primaryStrong : theme.color.textFaint,
                  textAlign: 'center',
                }}
              >
                {s.label}
              </Text>
            </View>
            {i < steps.length - 1 && (
              <View style={{ height: 2, flex: 1, marginTop: 5, backgroundColor: done ? theme.color.primary : theme.color.border }} />
            )}
          </View>
        );
      })}
    </View>
  );
}

export default function GapDetailScreen() {
  const { gapId } = useLocalSearchParams<{ gapId: string }>();
  const { childId } = useChild();
  const api = useClient('PARENT');
  const q = useQuery<GapDetail>(() => api.get(`/children/${childId}/gaps/${gapId}`), [childId, gapId]);

  return (
    <Screen>
      {q.loading && <Loading />}
      {q.error && <ErrorNote message={q.error} />}
      {q.data && (
        <>
          <Card tone="attention">
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ paddingHorizontal: 9, paddingVertical: 4, backgroundColor: theme.color.attentionChipBg, borderRadius: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: theme.color.attentionHeading }}>
                  {q.data.priorityLabel.toUpperCase()}
                </Text>
              </View>
              <View style={{ paddingHorizontal: 9, paddingVertical: 4, backgroundColor: theme.color.surface, borderRadius: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: theme.color.attentionText }}>
                  {q.data.lifecycleLabel}
                </Text>
              </View>
            </View>
            <Text style={{ fontSize: 21, fontWeight: '800', lineHeight: 27, color: theme.color.attentionHeading }}>
              {q.data.title}
            </Text>
          </Card>

          <Card>
            <Overline>Vì sao DạyZi nghĩ vậy</Overline>
            <View style={{ gap: 8 }}>
              {q.data.whyAppThinks.map((w, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
                  <Text style={{ color: theme.color.primary, fontSize: 13 }}>•</Text>
                  <Body>{w}</Body>
                </View>
              ))}
            </View>
          </Card>

          {q.data.affects.length > 0 && (
            <Card>
              <Overline>Ảnh hưởng tới</Overline>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {q.data.affects.map((a, i) => (
                  <View
                    key={i}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 9,
                      backgroundColor: theme.color.primaryTint,
                      borderRadius: 11,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: theme.color.primaryStrong }}>{a}</Text>
                  </View>
                ))}
              </View>
            </Card>
          )}

          <Card>
            <Overline>Diễn biến</Overline>
            <Stepper steps={q.data.lifecycleStep} />
          </Card>

          {q.data.prescription && (
            <Card tone="primary">
              <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 1, color: '#A7E3DA' }}>
                AI ĐỀ XUẤT — BỐ MẸ CHỌN
              </Text>
              <Text style={{ fontSize: 19, fontWeight: '800', lineHeight: 25, color: theme.color.onDark }}>
                {q.data.prescription.summary}
              </Text>
              <Text style={{ fontSize: 13, lineHeight: 19.5, color: '#CDEAE6' }}>{q.data.prescription.rationale}</Text>
            </Card>
          )}

          {q.data.prescription && (
            <Card>
              <Overline>Nội dung mỗi phiên</Overline>
              <View style={{ gap: 0 }}>
                {q.data.prescription.perSession.map((p, i) => (
                  <View key={i}>
                    {i > 0 && <View style={{ height: 1, backgroundColor: theme.color.surfaceRaised }} />}
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingVertical: 9,
                      }}
                    >
                      <Text style={{ fontSize: 13.5, color: theme.color.textBody }}>{p.label}</Text>
                      <Text style={{ fontSize: 13.5, fontWeight: '800', color: theme.color.textHeading }}>
                        {p.count}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </Card>
          )}

          {q.data.prescription && q.data.prescription.options.length > 0 && (
            <Card>
              <Text style={{ fontSize: 12.5, fontWeight: '700', color: theme.color.textBody }}>
                Bố mẹ muốn theo cách nào?
              </Text>
              <View style={{ gap: 6, marginTop: 2 }}>
                {q.data.prescription.options.map((o) => {
                  const isFollow = o.key === 'follow';
                  return (
                    <View
                      key={o.key}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        padding: 11,
                        borderRadius: 14,
                        backgroundColor: isFollow ? theme.color.primaryTint : theme.color.surface,
                        borderWidth: isFollow ? 2 : 1,
                        borderColor: isFollow ? theme.color.primary : theme.color.border,
                      }}
                    >
                      <View
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 10,
                          backgroundColor: isFollow ? theme.color.primary : 'transparent',
                          borderWidth: isFollow ? 0 : 2,
                          borderColor: theme.color.border,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {isFollow && <Text style={{ color: theme.color.onDark, fontSize: 11, fontWeight: '800' }}>✓</Text>}
                      </View>
                      <View style={{ flex: 1, gap: 1 }}>
                        <Text style={{ fontSize: 14.5, fontWeight: '700', color: theme.color.textHeading }}>
                          {o.label}
                        </Text>
                        <Text style={{ fontSize: 12, color: isFollow ? theme.color.primaryStrong : theme.color.textMuted }}>
                          {o.detail}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
              <Muted>DạyZi đang áp dụng "Theo đề xuất" — các lựa chọn khác để bố mẹ tham khảo.</Muted>
            </Card>
          )}

          <Button
            label="DạyZi hướng dẫn bạn dạy con phần này"
            onPress={() => router.push({ pathname: '/parent/teach', params: { gapId: String(gapId) } })}
          />
        </>
      )}
    </Screen>
  );
}
