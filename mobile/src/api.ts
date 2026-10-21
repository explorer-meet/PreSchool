import * as SecureStore from 'expo-secure-store';

// Android emulator reaches host machine at 10.0.2.2; override with EXPO_PUBLIC_API_URL for a real device.
export const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000/api';

let token: string | null = null;
export const setToken = (t: string | null) => { token = t; };
export const authHeaders = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});
export const mediaUri = (id: string) => ({ uri: `${BASE}/media/${id}/file`, headers: authHeaders() });

async function parse(r: Response) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  return parse(await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

export async function upload<T = any>(path: string, form: FormData): Promise<T> {
  return parse(await fetch(BASE + path, { method: 'POST', headers: authHeaders(), body: form }));
}

export const store = {
  get: () => SecureStore.getItemAsync('session'),
  set: (v: string) => SecureStore.setItemAsync('session', v),
  clear: () => SecureStore.deleteItemAsync('session'),
};
