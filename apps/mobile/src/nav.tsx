import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { theme } from './theme';

type Item = { label: string; glyph: string; href: string; raised?: boolean };

function Bar({ items }: { items: Item[] }) {
  const path = usePathname();
  return (
    <View style={styles.bar}>
      {items.map((it) => {
        const active = path === it.href || path.startsWith(it.href + '/');
        const onPress = () => {
          if (!active) router.navigate(it.href as never);
        };
        // navigate (not replace): pops back to an existing instance of the
        // tab if it's already in the stack, else pushes — far more robust
        // on expo-router 7 than replacing the stack top every tap.
        if (it.raised) {
          return (
            <Pressable key={it.href} style={styles.item} onPress={onPress}>
              <View style={styles.raisedButton}>
                <Text style={styles.raisedGlyph}>{it.glyph}</Text>
              </View>
              <Text style={[styles.label, styles.raisedLabel]}>{it.label}</Text>
            </Pressable>
          );
        }
        return (
          <Pressable key={it.href} style={styles.item} onPress={onPress}>
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
        { label: 'Bài tập', glyph: '⌗', href: '/parent/practice', raised: true },
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
    alignItems: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    backgroundColor: theme.color.surface,
    paddingTop: 10,
    paddingBottom: 6,
  },
  item: { flex: 1, alignItems: 'center', paddingVertical: 8, gap: 4 },
  glyph: { fontSize: 18, color: theme.color.textFaint },
  label: { fontSize: 10.5, color: theme.color.textFaint },
  activeText: { color: theme.color.primary, fontWeight: '700' },
  raisedButton: {
    width: 50,
    height: 50,
    marginTop: -16,
    borderRadius: 17,
    backgroundColor: theme.color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.color.primary,
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  raisedGlyph: { fontSize: 20, color: theme.color.onDark },
  raisedLabel: { color: theme.color.primary, fontWeight: '700' },
});
