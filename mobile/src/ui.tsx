import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from './api';

export const colors = { primary: '#ff7a59', bg: '#fff8f3', card: '#ffffff', text: '#2d2a32', muted: '#8a8594', ok: '#2e9e6b', warn: '#e0a100', bad: '#d64545' };

export const money = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
export const day = (d: string | Date) => new Date(d).toDateString();
export const isoToday = (plus = 0) => { const d = new Date(Date.now() + plus * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export const Card = ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
  <TouchableOpacity disabled={!onPress} onPress={onPress} style={s.card} activeOpacity={0.7}>{children}</TouchableOpacity>
);
export const Title = ({ children }: { children: React.ReactNode }) => <Text style={s.title}>{children}</Text>;
export const Sub = ({ children }: { children: React.ReactNode }) => <Text style={s.sub}>{children}</Text>;
export const Heading = ({ children }: { children: React.ReactNode }) => <Text style={s.heading}>{children}</Text>;

export const Badge = ({ text, color = colors.muted }: { text: string; color?: string }) => (
  <View style={{ alignSelf: 'flex-start', backgroundColor: color + '22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 }}>
    <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{text}</Text>
  </View>
);

export const Button = ({ label, onPress, busy, secondary, danger }: { label: string; onPress: () => void; busy?: boolean; secondary?: boolean; danger?: boolean }) => (
  <TouchableOpacity style={[s.btn, secondary && s.btnSecondary, danger && { backgroundColor: colors.bad, borderColor: colors.bad }]} onPress={onPress} disabled={busy}>
    {busy ? <ActivityIndicator color={secondary ? colors.primary : '#fff'} /> : <Text style={[s.btnText, secondary && !danger && { color: colors.primary }]}>{label}</Text>}
  </TouchableOpacity>
);

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
      <Text style={{ color: active ? '#fff' : colors.text }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Segmented({ tabs, value, onChange }: { tabs: string[]; value: string; onChange: (t: string) => void }) {
  return (
    <View style={{ height: 52, backgroundColor: colors.bg }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 10 }}>
        {tabs.map((t) => <Chip key={t} label={t} active={t === value} onPress={() => onChange(t)} />)}
      </ScrollView>
    </View>
  );
}

// Simple data hook: loads on focus, exposes reload and error.
export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    if (!path) return;
    try { setData(await api<T>('GET', path)); setErr(''); } catch (e: any) { setErr(e.message); }
  }, [path]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return { data, err, reload: load };
}

export function Loading() { return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>; }

// Scrollable page for non-list content (dashboards, summaries) with pull-to-refresh.
export function Page({ children, onRefresh }: { children: React.ReactNode; onRefresh?: () => Promise<void> | void }) {
  const [r, setR] = useState(false);
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={r} onRefresh={async () => { setR(true); await onRefresh(); setR(false); }} /> : undefined}>
      {children}
    </ScrollView>
  );
}

export function ListScreen<T extends { id: string }>({ path, render, empty = 'Nothing here yet', header, numColumns }: {
  path: string; render: (item: T, reload: () => void) => React.ReactNode; empty?: string; header?: React.ReactNode; numColumns?: number;
}) {
  const { data, err, reload } = useFetch<T[]>(path);
  const [refreshing, setRefreshing] = useState(false);
  if (!data && !err) return <Loading />;
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}
      data={data ?? []} keyExtractor={(i) => i.id} numColumns={numColumns} key={numColumns}
      ListHeaderComponent={<>{header}{err ? <Text style={s.err}>{err}</Text> : null}</>}
      ListEmptyComponent={!err ? <Sub>{empty}</Sub> : undefined}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}
      renderItem={({ item }) => <>{render(item, reload)}</>}
    />
  );
}

export interface Opt { value: string; label: string }
export interface FieldDef {
  key: string; label: string; required?: boolean; placeholder?: string;
  kind?: 'text' | 'number' | 'money' | 'date' | 'time' | 'password' | 'select' | 'multiline' | 'email' | 'phone';
  options?: Opt[]; optionsPath?: string; optionLabel?: (x: any) => string; optionFilter?: (x: any) => boolean; // select: static or fetched options
}

function setDeep(o: any, key: string, v: any) {
  const parts = key.split('.');
  parts.slice(0, -1).forEach((p) => (o = o[p] ??= {}));
  o[parts[parts.length - 1]] = v;
}

function SelectField({ f, value, onChange }: { f: FieldDef; value: string; onChange: (v: string) => void }) {
  const [opts, setOpts] = useState<Opt[]>(f.options ?? []);
  const [loading, setLoading] = useState(!!f.optionsPath);
  useEffect(() => {
    if (!f.optionsPath) return;
    api<any[]>('GET', f.optionsPath)
      .then((rows) => setOpts(rows.filter(f.optionFilter ?? (() => true)).map((r) => ({ value: r.id, label: f.optionLabel ? f.optionLabel(r) : r.name }))))
      .catch(() => {}).finally(() => setLoading(false));
  }, [f.optionsPath]);
  if (loading) return <ActivityIndicator color={colors.primary} />;
  if (!opts.length) return <Sub>No options available yet. Create them first.</Sub>;
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{opts.map((o) => <Chip key={o.value} label={o.label} active={o.value === value} onPress={() => onChange(o.value)} />)}</View>;
}

export function FormScreen({ fields, submit, submitLabel = 'Save', onDone, transform, intro }: {
  fields: FieldDef[]; submit: (body: any) => Promise<any>; submitLabel?: string; onDone: (result: any) => void;
  transform?: (b: any) => any; intro?: string;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));

  async function go() {
    const body: any = {};
    for (const f of fields) {
      const v = (vals[f.key] ?? '').trim();
      if (!v) { if (f.required !== false) return Alert.alert('Missing', `${f.label} is required`); continue; }
      let parsed: string | number = v;
      if (f.kind === 'number' || f.kind === 'money') {
        parsed = Number(v);
        if (Number.isNaN(parsed)) return Alert.alert('Invalid', `${f.label} must be a number`);
        if (f.kind === 'money') parsed = Math.round(parsed * 100);
      }
      setDeep(body, f.key, parsed);
    }
    setBusy(true);
    try { onDone(await submit(transform ? transform(body) : body)); }
    catch (e: any) { Alert.alert('Error', e.message); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      {intro ? <Sub>{intro}</Sub> : null}
      {fields.map((f) => (
        <View key={f.key} style={{ marginBottom: 12, marginTop: 6 }}>
          <Text style={s.label}>{f.label}{f.required === false ? ' (optional)' : ''}</Text>
          {f.kind === 'select' ? <SelectField f={f} value={vals[f.key] ?? ''} onChange={(v) => set(f.key, v)} /> : (
            <TextInput
              style={[s.input, f.kind === 'multiline' && { height: 90, textAlignVertical: 'top' }]} value={vals[f.key] ?? ''}
              multiline={f.kind === 'multiline'} secureTextEntry={f.kind === 'password'} autoCapitalize={f.kind === 'text' || f.kind === 'multiline' || !f.kind ? 'sentences' : 'none'}
              keyboardType={f.kind === 'number' || f.kind === 'money' ? 'decimal-pad' : f.kind === 'phone' ? 'phone-pad' : f.kind === 'email' ? 'email-address' : 'default'}
              placeholder={f.placeholder ?? (f.kind === 'date' ? 'YYYY-MM-DD' : f.kind === 'time' ? 'HH:MM' : '')}
              onChangeText={(t) => set(f.key, t)}
            />
          )}
          {f.kind === 'date' ? (
            <View style={{ flexDirection: 'row', marginTop: 6 }}>
              <Chip label="Today" onPress={() => set(f.key, isoToday())} /><Chip label="Tomorrow" onPress={() => set(f.key, isoToday(1))} />
            </View>
          ) : null}
        </View>
      ))}
      <Button label={submitLabel} onPress={go} busy={busy} />
    </ScrollView>
  );
}

export const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 10, elevation: 2, shadowOpacity: 0.06, shadowRadius: 6 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  heading: { fontSize: 18, fontWeight: '800', color: colors.text, marginVertical: 8 },
  sub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  btn: { backgroundColor: colors.primary, padding: 14, borderRadius: 12, alignItems: 'center', marginVertical: 6, borderWidth: 1, borderColor: colors.primary },
  btnSecondary: { backgroundColor: '#fff' },
  btnText: { color: '#fff', fontWeight: '700' },
  label: { fontSize: 13, color: colors.muted, marginBottom: 4 },
  input: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#eadfd6', padding: 12 },
  err: { color: colors.bad, marginBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, marginBottom: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#eadfd6' },
});

