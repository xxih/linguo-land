import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth';

export default function AppLayout() {
  const phase = useAuthStore((s) => s.phase);
  if (phase !== 'authed') return <Redirect href="/(auth)/login" />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#ffffff' },
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen name="index" options={{ title: '书架' }} />
      <Stack.Screen name="upload" options={{ title: '上传文档', presentation: 'modal' }} />
      <Stack.Screen name="reader/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="vocab/index" options={{ title: '生词本' }} />
      <Stack.Screen name="settings" options={{ title: '设置' }} />
    </Stack>
  );
}
