import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { theme } from './theme';

type Item = { label: string; glyph: string; href: string };

function Bar({ items }: { items: Item[] }) {
  const path = usePathname();
  return (
    <View style={styles.bar}>
      {items.map((it) => {
        const active = path === it.href || path.startsWith(it.href + '/');
        return (
          <Pressable
            key={it.href}
            style={styles.item}
            // navigate (not replace): pops back to an existing instance of the
            // tab if it's already in the stack, else pushes — far more robust
            // on expo-router 7 than replacing the stack top every tap.
            onPress={() => {
              if (!active) router.navigate(it.href as never);
            }}
          >
            <Text style={[styles.glyph, active && styles.activeText]}>{it.glyph}</Text>
            <Text style={[styles.label, active && styles.activeText]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ParentNav() {
  return (
    <Bar
      items={[
        { label: 'Hôm nay', glyph: '◉', href: '/parent/home' },
        { label: 'Tiến độ', glyph: '◔', href: '/parent/progress' },
        { label: 'Bài tập', glyph: '⌗', href: '/parent/practice' },
        { label: 'Tài liệu', glyph: '▤', href: '/parent/uploads' },
        { label: 'Cài đặt', glyph: '⚙', href: '/parent/settings' },
      ]}
    />
  );
}

export function StudentNav() {
  return (
    <Bar
      items={[
        { label: 'Hôm nay', glyph: '◉', href: '/student/today' },
        { label: 'Bài tập', glyph: '⌗', href: '/student/practice' },
        { label: 'Tiến bộ', glyph: '◔', href: '/student/progress' },
      ]}
    />
  );
}

export function TeacherNav() {
  return (
    <Bar
      items={[{ label: 'Học sinh', glyph: '◍', href: '/teacher/students' }]}
    />
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    backgroundColor: theme.color.surface,
    paddingBottom: 6,
  },
  item: { flex: 1, alignItems: 'center', paddingVertical: 8, gap: 2 },
  glyph: { fontSize: 18, color: theme.color.textFaint },
  label: { fontSize: 10.5, color: theme.color.textFaint },
  activeText: { color: theme.color.primary, fontWeight: '700' },
});
