import * as SecureStore from 'expo-secure-store';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

// Android emulator reaches host machine at 10.0.2.2; override with EXPO_PUBLIC_API_URL for a real device.
// export const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000/api';


//When connect with mobile use this GTPL WIFI
// export const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.1.22:4000/api';

//When connect with mobile use this COLAB_406_JIO
export const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.29.162:4000/api';

let token: string | null = null;
export const setToken = (t: string | null) => { token = t; };
export const authHeaders = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});
export const mediaUri = (id: string) => ({ uri: `${BASE}/media/${id}/file`, headers: authHeaders() });

async function parse(r: Response) {
  if (!r.headers.get('content-type')?.includes('json')) throw new Error(`Unexpected server response (${r.status}). Check the API address and connection.`);
  const j = await r.json();
  if (!r.ok) {
    const details = j.details?.fieldErrors ? Object.entries(j.details.fieldErrors).map(([field, messages]) => `${field}: ${(messages as string[]).join(', ')}`).join('\n') : '';
    throw new Error(details || j.error || `Request failed (${r.status})`);
  }
  return j;
}

interface UploadAsset { uri: string; fileName?: string | null; mimeType?: string; fileSize?: number; file?: Blob }

export async function appendUploadFile(form: FormData, field: string, asset: UploadAsset, imageOnly = true) {
  const nativeFile = Platform.OS === 'web' ? null : new File(asset.uri);
  let file = nativeFile ?? asset.file;
  if (!file) {
    const response = await fetch(asset.uri);
    if (!response.ok) throw new Error('Could not read the selected file. Please select it again.');
    file = await response.blob();
  }
  const mime = asset.mimeType || file.type;
  if (imageOnly && !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  if (imageOnly && file.size > 10 * 1024 * 1024) throw new Error('Images must be 10 MB or smaller.');
  if (!file.size) throw new Error('The selected file is empty or no longer accessible. Please select it again.');
  // Expo SDK 57 fetch requires Blob/File parts, not React Native URI descriptor objects.
  const part = file.type === mime ? file : new Blob([await file.arrayBuffer()], { type: mime });
  form.append(field, part, asset.fileName ?? nativeFile?.name ?? `${field}.${mime.split('/')[1] || 'bin'}`);
}

export async function api<T = any>(method: string, path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
  return parse(await fetch(BASE + path, {
    method,
    signal: options?.signal,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

export async function upload<T = any>(path: string, form: FormData, method = 'POST'): Promise<T> {
  return parse(await fetch(BASE + path, { method, headers: authHeaders(), body: form }));
}

export const store = {
  get: () => SecureStore.getItemAsync('session'),
  set: (v: string) => SecureStore.setItemAsync('session', v),
  clear: () => SecureStore.deleteItemAsync('session'),
};
