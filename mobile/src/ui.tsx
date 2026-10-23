import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, AppState, FlatList, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from './api';
import { usePopup } from './ResultPopup';

export const colors = {
  primary: '#2e9e6b',
  bg: '#fffaf4',
  card: '#ffffff',
  text: '#252b33',
  muted: '#66716d',
  ok: '#2e9e6b',
  warn: '#d99b12',
  bad: '#dc6258',
  border: '#eee7df',
  blue: '#e7f2fc',
};

export const money = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
export const day = (d: string | Date) => new Date(d).toDateString();
export const isoToday = (plus = 0) => { const d = new Date(Date.now() + plus * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export const Card = ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
  onPress ? <TouchableOpacity accessibilityRole="button" onPress={onPress} style={s.card} activeOpacity={0.75}>{children}</TouchableOpacity> : <View style={s.card}>{children}</View>
);
export const Title = ({ children }: { children: React.ReactNode }) => <Text style={s.title}>{children}</Text>;
export const Sub = ({ children }: { children: React.ReactNode }) => <Text style={s.sub}>{children}</Text>;
export const Heading = ({ children }: { children: React.ReactNode }) => <Text accessibilityRole="header" style={s.heading}>{children}</Text>;

export function ScreenHeader({ title, subtitle, icon }: { title: string; subtitle: string; icon?: string }) {
  return <View style={s.screenHeader}>
    {icon ? <Text accessible={false} style={s.headerIcon}>{icon}</Text> : null}
    <View style={{ flex: 1, minWidth: 0 }}><Heading>{title}</Heading><Sub>{subtitle}</Sub></View>
  </View>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <View accessibilityLiveRegion="polite" style={s.errorPanel}><Text style={s.err}>{message}</Text><Button label="Try again" secondary onPress={onRetry} /></View>;
}

export function ActionRow({ children }: { children: React.ReactNode }) {
  return <View style={s.actionRow}>{React.Children.toArray(children).filter(Boolean).map((child, index) =>
    <View key={index} style={s.actionItem}>{child}</View>)}</View>;
}

export const Badge = ({ text, color = colors.muted }: { text: string; color?: string }) => (
  <View style={{ alignSelf: 'flex-start', backgroundColor: color + '22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 }}>
    <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{text}</Text>
  </View>
);

export const Button = ({ label, onPress, busy, disabled, secondary, danger }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; secondary?: boolean; danger?: boolean }) => (
  <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!busy || !!disabled, busy: !!busy }} activeOpacity={0.75}
    style={[s.btn, secondary && s.btnSecondary, danger && (secondary ? s.btnDangerSecondary : s.btnDanger), (busy || disabled) && { opacity: 0.6 }]} onPress={onPress} disabled={busy || disabled}>
    {busy ? <ActivityIndicator color={danger ? colors.bad : secondary ? colors.primary : '#fff'} /> : null}
    <Text style={[s.btnText, secondary && { color: danger ? colors.bad : colors.primary }]}>{busy ? 'Saving…' : label}</Text>
  </TouchableOpacity>
);

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!active }} onPress={onPress} style={[s.chip, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
      <Text style={ [s.chipText, { color: active ? '#fff' : colors.text }] }>{label}</Text>
    </TouchableOpacity>
  );
}

export function Segmented({ tabs, value, onChange }: { tabs: (string | { value: string; label: string; icon?: string })[]; value: string; onChange: (t: string) => void }) {
  return (
    <View style={s.segmentedSurface}><View accessibilityRole="tablist" style={s.segmented}>
      {tabs.map((tab) => {
        const option = typeof tab === 'string' ? { value: tab, label: tab } : tab;
        const active = option.value === value;
        return <TouchableOpacity key={option.value} accessibilityRole="tab" accessibilityLabel={option.label} accessibilityState={{ selected: active }}
          activeOpacity={0.75} onPress={() => onChange(option.value)} style={[s.segment, active && s.segmentActive]}>
          {option.icon ? <Text style={s.segmentIcon} accessible={false}>{option.icon}</Text> : null}
          <Text style={[s.segmentText, active && s.segmentTextActive]}>{option.label}</Text>
        </TouchableOpacity>;
      })}
    </View></View>
  );
}

export function useFetch<T>(path: string | null, refreshInterval = 0) {
  const [state, setState] = useState<{ path: string | null; data: T | null; err: string; loading: boolean; updatedAt: Date | null }>({ path, data: null, err: '', loading: false, updatedAt: null });
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const focused = useRef(false);
  const load = useCallback(async () => {
    if (!path || !focused.current) return;
    const id = ++request.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState((previous) => ({ path, data: previous.path === path ? previous.data : null, err: previous.path === path ? previous.err : '', loading: true, updatedAt: previous.path === path ? previous.updatedAt : null }));
    try {
      const data = await api<T>('GET', path, undefined, { signal: abort.signal });
      if (focused.current && id === request.current) setState({ path, data, err: '', loading: false, updatedAt: new Date() });
    } catch (error) {
      if (focused.current && id === request.current && !abort.signal.aborted) setState((previous) => ({ ...previous, err: error instanceof Error ? error.message : 'Unable to load data. Please try again.', loading: false }));
    }
  }, [path]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    void load();
    const subscription = AppState.addEventListener('change', (status) => { if (status === 'active') void load(); });
    const timer = refreshInterval > 0 ? setInterval(() => { if (!AppState.currentState || AppState.currentState === 'active') void load(); }, refreshInterval) : undefined;
    return () => { focused.current = false; ++request.current; controller.current?.abort(); subscription.remove(); if (timer) clearInterval(timer); };
  }, [load, refreshInterval]));
  const current = state.path === path;
  return { data: current ? state.data : null, err: current ? state.err : '', loading: !!path && (!current || state.loading), updatedAt: current ? state.updatedAt : null, reload: load };
}

export function Loading() { return <View style={s.center} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.primary} size="large" /><Sub>Loading the latest information…</Sub></View>; }

// Scrollable page for non-list content (dashboards, summaries) with pull-to-refresh.
export function Page({ children, onRefresh }: { children: React.ReactNode; onRefresh?: () => Promise<void> | void }) {
  const [r, setR] = useState(false);
  return (
    <ScrollView style={s.surface} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      refreshControl={onRefresh ? <RefreshControl tintColor={colors.primary} refreshing={r} onRefresh={async () => { setR(true); try { await onRefresh(); } finally { setR(false); } }} /> : undefined}>
      {children}
    </ScrollView>
  );
}

export function ListScreen<T extends { id: string }>({ path, render, empty = 'Nothing here yet', header, numColumns, searchText, filters, countLabel = 'records', refreshInterval = 30000 }: {
  path: string; render: (item: T, reload: () => void) => React.ReactNode; empty?: string; header?: React.ReactNode; numColumns?: number;
  searchText?: (item: T) => string; filters?: { label: string; value: (item: T) => string }[]; countLabel?: string;
  refreshInterval?: number;
}) {
  const { data, err, reload, loading, updatedAt } = useFetch<T[]>(path, refreshInterval);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, string>>({});
  const rows = (data ?? []).filter((item) => (!searchText || searchText(item).toLowerCase().includes(query.trim().toLowerCase())) &&
    (filters ?? []).every((filter) => !selected[filter.label] || filter.value(item) === selected[filter.label]));
  if (!data && !err) return <Loading />;
  return (
    <FlatList
      style={s.surface} contentContainerStyle={s.content}
      data={rows} keyExtractor={(i) => i.id} numColumns={numColumns} key={numColumns}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      ListHeaderComponent={<>
        {header}
        {searchText ? <>
          <View style={s.listSummary}><Heading>{countLabel.charAt(0).toUpperCase() + countLabel.slice(1)}</Heading><Badge text={String(data?.length ?? 0)} color={colors.primary} /></View>
          <TextInput accessibilityLabel={`Search ${countLabel}`} placeholder={`Search ${countLabel}`} value={query} onChangeText={setQuery} style={[s.input, { marginBottom: 12 }]} autoCapitalize="none" clearButtonMode="while-editing" />
          {(filters ?? []).map((filter) => <View key={filter.label} style={s.filterGroup}>
            <Sub>{filter.label}</Sub>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8 }}>
              <Chip label="All" active={!selected[filter.label]} onPress={() => setSelected((old) => ({ ...old, [filter.label]: '' }))} />
              {[...new Set((data ?? []).map(filter.value).filter(Boolean))].sort().map((value) => <Chip key={value} label={value} active={selected[filter.label] === value} onPress={() => setSelected((old) => ({ ...old, [filter.label]: value }))} />)}
              {selected[filter.label] && !(data ?? []).some((item) => filter.value(item) === selected[filter.label]) ? <Chip label={selected[filter.label]} active onPress={() => setSelected((old) => ({ ...old, [filter.label]: '' }))} /> : null}
            </ScrollView>
          </View>)}
          <View style={s.listSummary}><Sub>Showing {rows.length} of {data?.length ?? 0}</Sub>
            {query || Object.values(selected).some(Boolean) ? <Chip label="Clear filters" onPress={() => { setQuery(''); setSelected({}); }} /> : null}
          </View>
        </> : null}
        {loading && data ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} /> : null}
        {updatedAt ? <Text style={s.updated}>Updated {updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · pull to refresh</Text> : null}
        {err ? <ErrorState message={data ? `Could not refresh. Showing the last saved data. ${err}` : err} onRetry={reload} /> : null}
      </>}
      ListEmptyComponent={!err ? <Card><Title>{data?.length ? 'No matching results' : empty}</Title><Sub>{data?.length ? 'Try a different name or change the filters.' : header ? 'Use the action above to get started.' : 'New records will appear here when available.'}</Sub></Card> : undefined}
      refreshControl={<RefreshControl tintColor={colors.primary} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); try { await reload(); } finally { setRefreshing(false); } }} />}
      renderItem={({ item }) => <>{render(item, reload)}</>}
    />
  );
}

export interface Opt { value: string; label: string }
export interface FieldDef {
  key: string; label: string; required?: boolean; placeholder?: string;
  kind?: 'text' | 'number' | 'money' | 'date' | 'time' | 'password' | 'select' | 'multiline' | 'email' | 'phone';
  options?: Opt[]; optionsPath?: string; optionLabel?: (x: any) => string; optionFilter?: (x: any) => boolean; // select: static or fetched options
  visibleWhen?: { key: string; value: string }; emptyValue?: string | null; help?: string;
  min?: number; max?: number; integer?: boolean; minLength?: number; maxLength?: number;
}

export function visibleFields(fields: FieldDef[], values: Record<string, string>) {
  return fields.filter((field) => !field.visibleWhen || values[field.visibleWhen.key] === field.visibleWhen.value);
}

export function fieldError(field: FieldDef, value: string): string {
  const v = value.trim();
  if (!v) return field.required === false ? '' : `${field.label} is required.`;
  if (field.minLength && v.length < field.minLength) return `Enter at least ${field.minLength} characters.`;
  if (field.maxLength && v.length > field.maxLength) return `Use ${field.maxLength} characters or fewer.`;
  if (field.kind === 'number' || field.kind === 'money') {
    const number = Number(v);
    if (!Number.isFinite(number)) return 'Enter a valid number.';
    if (field.integer && !Number.isInteger(number)) return 'Enter a whole number.';
    if (field.min != null && number < field.min) return `Enter ${field.min} or more.`;
    if (field.max != null && number > field.max) return `Enter ${field.max} or less.`;
  }
  if (field.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email address.';
  if (field.kind === 'phone' && (v.replace(/\D/g, '').length < 8 || !/^\+?[\d ()-]{8,20}$/.test(v))) return 'Enter a valid phone number with at least eight digits.';
  if (field.kind === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)) return 'Use a valid date in YYYY-MM-DD format.';
  if (field.kind === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return 'Use HH:MM (24-hour time).';
  return '';
}

function setDeep(o: any, key: string, v: any) {
  const parts = key.split('.');
  parts.slice(0, -1).forEach((p) => (o = o[p] ??= {}));
  o[parts[parts.length - 1]] = v;
}

function SelectField({ f, value, onChange }: { f: FieldDef; value: string; onChange: (v: string) => void }) {
  const [opts, setOpts] = useState<Opt[]>(f.options ?? []);
  const [loading, setLoading] = useState(!!f.optionsPath);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const { optionsPath, optionFilter, optionLabel } = f;
  useEffect(() => {
    if (!optionsPath) return;
    let active = true;
    api<any[]>('GET', optionsPath)
      .then((rows) => { if (active) setOpts(rows.filter(optionFilter ?? (() => true)).map((r) => ({ value: r.id, label: optionLabel ? optionLabel(r) : r.name }))); })
      .catch((error: Error) => { if (active) setLoadError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [optionsPath, optionFilter, optionLabel, attempt]);
  if (loading) return <ActivityIndicator color={colors.primary} />;
  if (loadError) return <ErrorState message={loadError} onRetry={() => { setLoading(true); setLoadError(''); setAttempt((previous) => previous + 1); }} />;
  if (!opts.length) return <View><Sub>No options available yet. Create them first.</Sub>{f.required === false ? <Chip label="None" active={!value} onPress={() => onChange('')} /> : null}</View>;
  const matching = opts.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  return <View>
    {opts.length > 8 ? <TextInput accessibilityLabel={`Search ${f.label}`} style={[s.input, { marginBottom: 8 }]} placeholder={`Search ${f.label.toLowerCase()}`} value={query} onChangeText={setQuery} /> : null}
    {value && opts.length > 8 ? <Sub>Selected: {opts.find((option) => option.value === value)?.label ?? 'No longer available — select another option'}</Sub> : null}
    <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingTop: 4 }}>
        {f.required === false ? <Chip label="None" active={!value} onPress={() => onChange('')} /> : null}
        {matching.map((o) => <Chip key={o.value} label={o.label} active={o.value === value} onPress={() => onChange(o.value)} />)}
      </View>
      {!matching.length ? <Sub>No matching options.</Sub> : null}
    </ScrollView>
  </View>;
}

export function FormScreen({ fields, submit, submitLabel = 'Save', onDone, transform, intro, initialValues, topContent }: {
  fields: FieldDef[]; submit: (body: any) => Promise<any>; submitLabel?: string; onDone: (result: any) => void;
  transform?: (b: any) => any; intro?: string; initialValues?: Record<string, unknown>; topContent?: React.ReactNode;
}) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(
    Object.entries(initialValues ?? {}).map(([key, value]) => [key, value == null ? '' : String(value)]),
  ));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const formRef = useRef<ScrollView>(null);
  const submitting = useRef(false);
  const [entrance] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = Animated.timing(entrance, { toValue: 1, duration: 280, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [entrance]);
  const set = (k: string, v: string) => { setVals((p) => ({ ...p, [k]: v })); setErrors((previous) => ({ ...previous, [k]: '' })); };
  const popup = usePopup();
  const shownFields = visibleFields(fields, vals);

  async function go() {
    if (submitting.current) return;
    const invalid: Record<string, string> = Object.fromEntries(shownFields.map((field): [string, string] => [field.key, fieldError(field, vals[field.key] ?? '')]).filter(([, error]) => error));
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      formRef.current?.scrollTo({ y: 0, animated: true });
      return popup.warn('Check your details', Object.values(invalid)[0]);
    }
    const body: any = {};
    for (const f of shownFields) {
      const v = (vals[f.key] ?? '').trim();
      if (!v) { if (f.emptyValue !== undefined) setDeep(body, f.key, f.emptyValue); continue; }
      let parsed: string | number = v;
      if (f.kind === 'number' || f.kind === 'money') {
        parsed = Number(v);
        if (f.kind === 'money') parsed = Math.round(parsed * 100);
      }
      setDeep(body, f.key, parsed);
    }
    submitting.current = true;
    setBusy(true);
    try { onDone(await submit(transform ? transform(body) : body)); }
    catch (e: any) { popup.error(e.message); }
    finally { submitting.current = false; setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={s.surface} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={96}>
    <ScrollView ref={formRef} style={s.surface} contentContainerStyle={[s.content, { maxWidth: 760 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
      <Animated.View style={{ opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
      {intro ? <View style={s.intro}><Sub>{intro}</Sub></View> : null}
      {topContent}
      {Object.values(errors).some(Boolean) ? <Text accessibilityRole="alert" style={s.err}>Please correct the highlighted fields below.</Text> : null}
      <View style={s.formCard}>
      {shownFields.map((f) => (
        <View key={f.key} style={{ marginBottom: 16, marginTop: 6 }}>
          <Text style={s.label}>{f.label}{f.required === false ? ' (optional)' : ''}</Text>
          {f.kind === 'select' ?           <SelectField key={`${f.key}-${f.optionsPath ?? 'static'}`} f={f} value={vals[f.key] ?? ''} onChange={(v) => set(f.key, v)} /> : (
            <TextInput
              accessibilityLabel={f.label} editable={!busy}
              style={[s.input, f.kind === 'multiline' && { minHeight: 100, textAlignVertical: 'top' }, errors[f.key] && { borderColor: colors.bad }]} value={vals[f.key] ?? ''}
              multiline={f.kind === 'multiline'} secureTextEntry={f.kind === 'password'} autoCapitalize={f.kind === 'text' || f.kind === 'multiline' || !f.kind ? 'sentences' : 'none'}
              keyboardType={f.kind === 'number' || f.kind === 'money' ? 'decimal-pad' : f.kind === 'phone' ? 'phone-pad' : f.kind === 'email' ? 'email-address' : 'default'}
              placeholder={f.placeholder ?? (f.kind === 'date' ? 'YYYY-MM-DD' : f.kind === 'time' ? 'HH:MM' : '')}
              onChangeText={(t) => set(f.key, t)}
              onBlur={() => setErrors((previous) => ({ ...previous, [f.key]: fieldError(f, vals[f.key] ?? '') }))}
            />
          )}
          {errors[f.key] ? <Text accessibilityLiveRegion="polite" style={s.fieldError}>{errors[f.key]}</Text> : f.help ? <Sub>{f.help}</Sub> : null}
          {f.kind === 'date' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
              <Chip label="Today" onPress={() => set(f.key, isoToday())} /><Chip label="Tomorrow" onPress={() => set(f.key, isoToday(1))} />
            </View>
          ) : null}
        </View>
      ))}
      </View>
      <Button label={submitLabel} onPress={go} busy={busy} />
      </Animated.View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function ModalPage({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={s.surface} edges={['top', 'bottom', 'left', 'right']}><KeyboardAvoidingView style={s.surface} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><Page>{children}</Page></KeyboardAvoidingView></SafeAreaView>;
}

export const s = StyleSheet.create({
  surface: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 18, paddingBottom: 40, width: '100%', maxWidth: 1040, alignSelf: 'center', flexGrow: 1 },
  screenHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  headerIcon: { fontSize: 26, padding: 12, backgroundColor: '#e8f6ef', borderRadius: 16 },
  listSummary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  actionItem: { flexBasis: 160, flexGrow: 1, minWidth: 0, maxWidth: '100%' },
  errorPanel: { backgroundColor: '#fff1ed', borderRadius: 14, borderWidth: 1, borderColor: '#f4c8c3', padding: 12, marginVertical: 12 },
  updated: { fontSize: 12, color: colors.muted, marginBottom: 14 },
  intro: { padding: 14, backgroundColor: '#e8f6ef', borderRadius: 14, marginBottom: 16 },
  formCard: { backgroundColor: '#fff', padding: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 20, marginBottom: 16 },
  fieldError: { color: colors.bad, fontSize: 12, lineHeight: 18, marginTop: 6 },
  filterGroup: { borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  card: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 12, elevation: 2, shadowColor: '#3c342c', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  title: { fontSize: 17, lineHeight: 25, fontWeight: '700', color: colors.text, flexShrink: 1 },
  heading: { fontSize: 21, fontWeight: '800', color: colors.text, marginVertical: 10, flexShrink: 1 },
  sub: { fontSize: 14, lineHeight: 22, color: colors.muted, marginTop: 4, flexShrink: 1 },
  btn: { flexDirection: 'row', gap: 8, backgroundColor: colors.primary, minHeight: 50, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginVertical: 5, borderWidth: 1, borderColor: colors.primary, maxWidth: '100%' },
  btnSecondary: { backgroundColor: '#fff', borderColor: colors.border },
  btnDanger: { backgroundColor: colors.bad, borderColor: colors.bad },
  btnDangerSecondary: { backgroundColor: '#fff4f2', borderColor: '#f4c8c3' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15, lineHeight: 22, textAlign: 'center', flexShrink: 1 },
  label: { fontSize: 13, color: colors.text, fontWeight: '600', marginBottom: 6 },
  input: { backgroundColor: '#fff', minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, color: colors.text, fontSize: 15 },
  err: { color: colors.bad, marginBottom: 8 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, marginRight: 8, marginBottom: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, maxWidth: '100%', flexShrink: 0 },
  chipText: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  segmentedSurface: { flexShrink: 0, backgroundColor: colors.bg },
  segmented: { flexDirection: 'row', flexWrap: 'wrap', flexShrink: 0, alignItems: 'stretch', gap: 8, padding: 12, backgroundColor: colors.bg, maxWidth: 1040, width: '100%', alignSelf: 'center' },
  segment: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexGrow: 1, flexBasis: 'auto', minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, gap: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 14 },
  segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentIcon: { fontSize: 17, flexShrink: 0 },
  segmentText: { color: colors.text, fontSize: 14, lineHeight: 21, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  segmentTextActive: { color: '#fff' },
});
