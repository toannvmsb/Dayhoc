import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from './theme';

export function Screen({
  children,
  scroll = true,
  nav,
  edges = ['top', 'bottom'],
}: {
  children: ReactNode;
  scroll?: boolean;
  nav?: ReactNode;
  edges?: ('top' | 'bottom')[];
}) {
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll}>{children}</ScrollView>
      ) : (
        <View style={styles.body}>{children}</View>
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
  scroll: { padding: 18, gap: 12, paddingBottom: 40 },
  body: { flex: 1, padding: 18, gap: 12 },
  h1: { fontSize: 24, fontWeight: '800', color: theme.color.textHeading },
  overline: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.color.textFaint,
  },
  muted: { fontSize: 12.5, color: theme.color.textMuted },
  bodyText: { fontSize: 14, color: theme.color.textBody, lineHeight: 20 },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: 14,
    gap: 6,
  },
  cardPrimary: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  cardAttention: { backgroundColor: theme.color.attentionBg, borderColor: '#FBD8D1' },
  btn: {
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.color.border },
  btnDanger: { backgroundColor: theme.color.attentionText },
  btnLabel: { color: theme.color.onDark, fontWeight: '700', fontSize: 15 },
  fieldLabel: { fontSize: 12.5, fontWeight: '600', color: theme.color.textMuted },
  input: {
    height: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    paddingHorizontal: 14,
    fontSize: 15,
    color: theme.color.textHeading,
    backgroundColor: theme.color.surface,
  },
});

export { theme };
