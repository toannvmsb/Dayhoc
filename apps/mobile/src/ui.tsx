import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from './theme';

const CHANNEL = String((Constants.expoConfig?.extra as { channel?: string } | undefined)?.channel ?? 'dev');

export function StagingBanner() {
  if (CHANNEL === 'production') return null;
  return (
    <View style={styles.stagingBanner}>
      <Text style={styles.stagingText}>
        {CHANNEL === 'staging' ? 'BẢN THỬ NGHIỆM (STAGING)' : 'BẢN DEV'}
      </Text>
    </View>
  );
}

export function Screen({
  children,
  scroll = true,
  nav,
  edges = ['top', 'bottom'],
  onRefresh,
  refreshing,
}: {
  children: ReactNode;
  scroll?: boolean;
  nav?: ReactNode;
  edges?: ('top' | 'bottom')[];
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.color.primary} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.body}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      <StagingBanner />
      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={8}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
      {nav}
    </SafeAreaView>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={styles.h1}>{children}</Text>;
}
export function Overline({ children }: { children: ReactNode }) {
  return <Text style={styles.overline}>{children}</Text>;
}
export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}
export function Body({ children }: { children: ReactNode }) {
  return <Text style={styles.bodyText}>{children}</Text>;
}

export function Card({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'primary' | 'attention';
}) {
  return (
    <View
      style={[
        styles.card,
        tone === 'primary' && styles.cardPrimary,
        tone === 'attention' && styles.cardAttention,
      ]}
    >
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  loading,
  disabled,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  tone?: 'primary' | 'ghost' | 'danger';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        tone === 'ghost' && styles.btnGhost,
        tone === 'danger' && styles.btnDanger,
        (pressed || disabled || loading) && { opacity: 0.7 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tone === 'ghost' ? theme.color.primary : theme.color.onDark} />
      ) : (
        <Text style={[styles.btnLabel, tone === 'ghost' && { color: theme.color.primary }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  secureTextEntry,
  keyboardType,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric';
  placeholder?: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
        placeholder={placeholder}
        placeholderTextColor={theme.color.textFaint}
      />
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <ActivityIndicator color={theme.color.primary} size="large" />
    </View>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <View style={[styles.card, styles.cardAttention]}>
      <Text style={{ color: theme.color.attentionText, fontSize: 13.5 }}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.bg },
  stagingBanner: { backgroundColor: theme.color.violet, paddingVertical: 3, alignItems: 'center' },
  stagingText: { color: theme.color.onDark, fontSize: 10, fontFamily: theme.font.bold, letterSpacing: 1 },
  scroll: { padding: 18, gap: 12, paddingBottom: 40 },
  body: { flex: 1, padding: 18, gap: 12 },
  h1: { fontSize: 24, fontFamily: theme.font.bold, color: theme.color.textHeading },
  overline: {
    fontSize: 11.5,
    fontFamily: theme.font.bold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.color.textFaint,
  },
  muted: { fontSize: 12.5, color: theme.color.textMuted, fontFamily: theme.font.regular },
  bodyText: { fontSize: 14, color: theme.color.textBody, lineHeight: 20, fontFamily: theme.font.regular },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: 14,
    gap: 6,
  },
  cardPrimary: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  cardAttention: { backgroundColor: theme.color.attentionBg, borderColor: theme.color.attentionBorder },
  btn: {
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.color.border },
  btnDanger: { backgroundColor: theme.color.danger },
  btnLabel: { color: theme.color.onDark, fontFamily: theme.font.bold, fontSize: 15 },
  fieldLabel: { fontSize: 12.5, fontFamily: theme.font.medium, color: theme.color.textMuted },
  input: {
    minHeight: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: theme.font.regular,
    color: theme.color.textHeading,
    backgroundColor: theme.color.surface,
  },
});

export { theme };
