import React, { createContext, useContext, useEffect, useState } from 'react';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api, setToken, store } from './api';

export type Role = 'SUPER_ADMIN' | 'PRINCIPAL' | 'TEACHER' | 'HELPER' | 'STAFF' | 'PARENT';
interface Session { token: string; user: { id: string; name: string; role: Role }; mustChangePassword: boolean }
interface Ctx {
  session: Session | null; loading: boolean;
  login(identifier: string, password: string): Promise<void>;
  logout(): Promise<void>;
  passwordChanged(): void;
}
const AuthCtx = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthCtx);

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

async function registerPush() {
  if (!Device.isDevice) return;
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;
  const t = await Notifications.getExpoPushTokenAsync();
  await api('POST', '/auth/device-token', { token: t.data }).catch(() => {});
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    store.get().then((raw) => {
      if (raw) { const s: Session = JSON.parse(raw); setToken(s.token); setSession(s); registerPush(); }
    }).finally(() => setLoading(false));
  }, []);

  const value: Ctx = {
    session, loading,
    async login(identifier, password) {
      const s = await api<Session>('POST', '/auth/login', { identifier, password });
      setToken(s.token);
      await store.set(JSON.stringify(s));
      setSession(s);
      registerPush();
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
