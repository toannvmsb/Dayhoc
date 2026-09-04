import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from './auth';
import { theme } from './theme';
import { Body, Overline } from './ui';

const HOME: Record<string, string> = {
  PARENT: '/parent/home',
  STUDENT: '/student/today',
  TEACHER: '/teacher/students',
};
const LABEL: Record<string, string> = { PARENT: 'Phụ huynh', STUDENT: 'Học sinh', TEACHER: 'Giáo viên' };

/** Shown only when the signed-in identity holds more than one role. */
export function WorkspaceSwitcher() {
  const { availableWorkspaces, workspace, setWorkspace } = useAuth();
  if (availableWorkspaces.length < 2) return null;

  return (
    <View style={{ gap: 6 }}>
      <Overline>Chế độ</Overline>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {availableWorkspaces.map((w) => {
          const on = w === workspace;
          return (
            <Pressable
              key={w}
              onPress={() => {
                if (on) return;
                setWorkspace(w);
                router.navigate(HOME[w] as never);
              }}
              style={{
                flex: 1,
                paddingVertical: 9,
                alignItems: 'center',
                borderRadius: theme.radius.sm,
                borderWidth: 1,
                borderColor: on ? theme.color.primary : theme.color.border,
                backgroundColor: on ? theme.color.primaryTint : theme.color.surface,
              }}
            >
              <Body>{LABEL[w] ?? w}</Body>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
