import { useEffect } from 'react';
import { Slot } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { useAuthStore } from '../src/stores/auth';
import '../global.css';

export default function RootLayout() {
  const phase = useAuthStore((s) => s.phase);
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        {phase === 'loading' ? (
          <View className="flex-1 items-center justify-center bg-white">
            <ActivityIndicator size="large" />
          </View>
        ) : (
          <Slot />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
