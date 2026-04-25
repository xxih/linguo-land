import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * 跨平台密钥存储。
 *
 * iOS / Android：用 expo-secure-store（Keychain / EncryptedSharedPreferences）。
 * Web（开发期跑 expo start --web）：SecureStore 不支持，回退 AsyncStorage。
 */
const useSecure = Platform.OS === 'ios' || Platform.OS === 'android';

export async function readSecure(key: string): Promise<string | null> {
  if (useSecure) {
    return SecureStore.getItemAsync(key);
  }
  return AsyncStorage.getItem(key);
}

export async function writeSecure(key: string, value: string): Promise<void> {
  if (useSecure) {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  await AsyncStorage.setItem(key, value);
}

export async function deleteSecure(key: string): Promise<void> {
  if (useSecure) {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  await AsyncStorage.removeItem(key);
}
