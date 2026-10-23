import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import * as Device from 'expo-device';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api, setToken, store } from './api';

let notificationHandlerConfigured = false;

export type Role = 'SUPER_ADMIN' | 'PRINCIPAL' | 'TEACHER' | 'HELPER' | 'STAFF' | 'PARENT';
interface Session { token: string; user: { id: string; name: string; role: Role }; mustChangePassword: boolean }
interface Ctx {
  session: Session | null; loading: boolean;
  login(identifier: string, password: string, beforeEnter?: () => Promise<void>): Promise<void>;
  logout(): Promise<void>;
  passwordChanged(): void;
}
const AuthCtx = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthCtx);

async function registerPush() {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  if (Platform.OS === 'android' && isRunningInExpoGo()) {
    console.info('Expo Go: Android remote push registration is skipped; login and dashboard features remain available.');
    return;
  }

  const Notifications = await import('expo-notifications');
  if (!notificationHandlerConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    notificationHandlerConfigured = true;
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return;
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    console.warn('Push token not registered: link this app to an EAS project with `npx eas-cli init`.');
    return;
  }
  const t = await Notifications.getExpoPushTokenAsync({ projectId });
  await api('POST', '/auth/device-token', { token: t.data });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const pushSession = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const restore = async () => {
      try {
        const raw = await store.get();
        if (!raw || !mounted) return;
        const saved: Session = JSON.parse(raw);
        setToken(saved.token);
        setSession(saved);
        pushSession.current = saved.token;
        void registerPush().catch((error: Error) => {
          if (pushSession.current === saved.token) pushSession.current = null;
          console.error('Push registration failed:', error.message);
        });
      } catch (error) {
        console.error('Unable to restore the saved session:', error);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void restore();
    return () => { mounted = false; };
  }, []);

  const value: Ctx = {
    session, loading,
    async login(identifier, password, beforeEnter) {
      const s = await api<Session>('POST', '/auth/login', { identifier, password });
      setToken(s.token);
      await store.set(JSON.stringify(s));
      // Lets the login screen play its success animation before the navigator swaps screens.
      if (beforeEnter) await beforeEnter();
      setSession(s);
      if (pushSession.current !== s.token) {
        pushSession.current = s.token;
        void registerPush().catch((error: Error) => {
          if (pushSession.current === s.token) pushSession.current = null;
          console.error('Push registration failed:', error.message);
        });
      }
    },
    async logout() { setToken(null); await store.clear(); setSession(null); },
    passwordChanged() {
      setSession((s) => {
        if (!s) return s;
        const n = { ...s, mustChangePassword: false };
        store.set(JSON.stringify(n));
        return n;
      });
    },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
