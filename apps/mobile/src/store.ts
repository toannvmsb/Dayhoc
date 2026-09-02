import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Token goes in the OS keychain / keystore (expo-secure-store) on native.
 * SecureStore is unavailable on web — fall back to localStorage there.
 * Non-secret preferences (selected child, workspace) use AsyncStorage.
 */
const secureOk = Platform.OS === 'ios' || Platform.OS === 'android';

export const secureStore = {
  async get(key: string): Promise<string | null> {
    try {
      if (secureOk) return await SecureStore.getItemAsync(key);
      return await AsyncStorage.getItem(`secure.${key}`);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      if (secureOk) await SecureStore.setItemAsync(key, value);
      else await AsyncStorage.setItem(`secure.${key}`, value);
    } catch {
      /* best-effort */
    }
  },
  async remove(key: string): Promise<void> {
    try {
      if (secureOk) await SecureStore.deleteItemAsync(key);
      else await AsyncStorage.removeItem(`secure.${key}`);
    } catch {
      /* best-effort */
    }
  },
};

export const prefStore = {
  get: (key: string) => AsyncStorage.getItem(key),
  set: (key: string, value: string) => AsyncStorage.setItem(key, value),
  remove: (key: string) => AsyncStorage.removeItem(key),
};
