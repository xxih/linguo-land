import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { getApiBaseUrl, setApiBaseUrl } from '../../src/lib/api';
import { useAuthStore } from '../../src/stores/auth';

export default function SettingsScreen() {
  const [baseUrl, setBaseUrl] = useState('');
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    void getApiBaseUrl().then(setBaseUrl);
  }, []);

  return (
    <View className="flex-1 bg-white px-6 pt-8">
      <Text className="text-sm text-gray-500 mb-1">已登录</Text>
      <Text className="text-base mb-6">{user?.email}</Text>

      <Text className="text-sm text-gray-500 mb-1">API 地址</Text>
      <TextInput
        value={baseUrl}
        onChangeText={setBaseUrl}
        autoCapitalize="none"
        className="border border-gray-200 rounded-md px-3 py-2 text-base"
        placeholder="http://10.0.2.2:3000"
      />
      <Pressable
        onPress={async () => {
          await setApiBaseUrl(baseUrl);
          Alert.alert('已保存', baseUrl);
        }}
        className="mt-3 py-2 rounded-md bg-blue-600"
      >
        <Text className="text-center text-white">保存</Text>
      </Pressable>

      <Pressable
        onPress={() =>
          Alert.alert('登出', '确认登出？', [
            { text: '取消', style: 'cancel' },
            { text: '登出', style: 'destructive', onPress: () => void logout() },
          ])
        }
        className="mt-12 py-3 rounded-md border border-red-300"
      >
        <Text className="text-center text-red-600">登出</Text>
      </Pressable>
    </View>
  );
}
