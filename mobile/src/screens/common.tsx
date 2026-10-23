import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { api } from '../api';
import { usePopup } from '../ResultPopup';
import { Tiny } from '../Tiny';
import { useAuth } from '../auth';
import { Badge, Button, Card, FormScreen, ListScreen, Page, ScreenHeader, Sub, Title, colors, day, s, useFetch } from '../ui';

export function LoginScreen({ navigation }: any) {
  const { login } = useAuth();
  const popup = usePopup();
  const [id, setId] = useState(''); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [focus, setFocus] = useState<'id' | 'pw' | null>(null);
  const [success, setSuccess] = useState(false);
  const [heroProgress] = useState(() => new Animated.Value(0));
  const [formProgress] = useState(() => new Animated.Value(0));
  const [footerProgress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.stagger(120, [heroProgress, formProgress, footerProgress].map((value) => Animated.timing(value, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }))).start();
  }, [footerProgress, formProgress, heroProgress]);

  const entrance = (value: Animated.Value) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
  });

  // Tiny covers his eyes while the password is hidden and being typed.
  const mood = success ? 'success' : focus === 'pw' && !showPw ? 'cover' : 'idle';
  const heading = success ? { title: 'You’re in!', sub: 'Opening your dashboard…' }
    : mood === 'cover' ? { title: 'No peeking!', sub: 'Tiny covers his eyes while you type' }
      : { title: 'Welcome back', sub: 'Log in to see your school!' };

  async function submit() {
    if (!id.trim() || !pw) { popup.warn('Almost there', 'Enter your email or phone and your password.'); return; }
    setBusy(true);
    try {
      await login(id.trim(), pw, async () => {
        setSuccess(true);
        await new Promise((resolve) => setTimeout(resolve, 1600));
      });
    } catch (e: any) {
      setSuccess(false);
      popup.error(e.message, 'Login failed');
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 28 }} keyboardShouldPersistTaps="handled">
        <Animated.View style={[loginStyles.hero, entrance(heroProgress)]}>
          <Tiny mood={mood} />
        </Animated.View>

        <Animated.View style={entrance(formProgress)}>
          <Text style={loginStyles.title}>{heading.title}</Text>
          <Text style={loginStyles.subtitle}>{heading.sub}</Text>
          <View style={loginStyles.form}>
            <Text style={s.label}>Email ID</Text>
            <TextInput style={[s.input, loginStyles.field, focus === 'id' && loginStyles.focused]} placeholder="you@school.in" placeholderTextColor="#a6a6a6" autoCapitalize="none" keyboardType="email-address" value={id} onChangeText={setId} onFocus={() => setFocus('id')} onBlur={() => setFocus(null)} editable={!busy} />
            <Text style={[s.label, { marginTop: 14 }]}>Password</Text>
            <View>
              <TextInput style={[s.input, loginStyles.field, loginStyles.passwordField, focus === 'pw' && loginStyles.focused]} placeholder="Enter your password" placeholderTextColor="#a6a6a6" secureTextEntry={!showPw} value={pw} onChangeText={setPw} onFocus={() => setFocus('pw')} onBlur={() => setFocus(null)} editable={!busy} />
              <Pressable accessibilityRole="button" accessibilityLabel={showPw ? 'Hide password' : 'Show password'} onPress={() => setShowPw((v) => !v)} style={loginStyles.eye}>
                <Text style={loginStyles.eyeText}>{showPw ? '🙈' : '👁'}</Text>
              </Pressable>
            </View>
            <Pressable accessibilityRole="link" onPress={() => navigation.navigate('ForgotPassword')} style={loginStyles.forgot}>
              <Text style={loginStyles.forgotText}>Forgot password?</Text>
            </Pressable>
            <Button label="Log in" busy={busy} onPress={submit} />
          </View>
        </Animated.View>

        <Animated.View style={[loginStyles.footer, entrance(footerProgress)]}>
          <View style={loginStyles.divider} />
          <Text style={loginStyles.registerPrompt}>Are you a school administrator?</Text>
          <Button label="Register your school" secondary onPress={() => navigation.navigate('RegisterSchool')} />
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const loginStyles = {
  hero: { marginBottom: 4 },
  focused: { borderColor: colors.primary, borderWidth: 1.5 },
  passwordField: { paddingRight: 44 },
  eye: { position: 'absolute' as const, right: 6, top: 0, bottom: 4, width: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  eyeText: { fontSize: 18 },
  forgot: { alignSelf: 'flex-end' as const, paddingVertical: 8 },
  forgotText: { color: colors.primary, fontSize: 12, fontWeight: '700' as const },

  title: { color: colors.text, fontWeight: '800' as const, fontSize: 27, textAlign: 'center' as const },
  subtitle: { color: colors.muted, fontSize: 14, textAlign: 'center' as const, marginTop: 6, marginBottom: 20 },
  form: { padding: 18, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  field: { marginBottom: 4 },
  footer: { marginTop: 14 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 14 },
  registerPrompt: { color: colors.muted, fontSize: 13, textAlign: 'center' as const, marginBottom: 4 },
};

export function ForgotPasswordScreen({ navigation }: any) {
  const popup = usePopup();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [enter] = useState(() => new Animated.Value(0));

  // Re-run the fade/slide whenever the step changes.
  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [step, enter]);

  const strength = [pw.length >= 8, /\d/.test(pw), /[A-Z]/.test(pw), /[^A-Za-z0-9]/.test(pw)].filter(Boolean).length;
  const strengthColor = strength >= 4 ? colors.primary : strength >= 2 ? colors.warn : colors.bad;
  const field = (name: string) => [s.input, focus === name && loginStyles.focused];

  async function sendCode() {
    const value = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(value)) { popup.warn('Check your email', 'Enter the email your school gave you.'); return; }
    setBusy(true);
    try {
      await api('POST', '/auth/forgot-password', { email: value });
      setEmail(value);
      setStep('reset');
      popup.success('Code on its way!', 'If this email is registered, a 6-digit code was sent. Check your spam folder too.', { emoji: '📧', duration: 3200 });
    } catch (e: any) { popup.error(e.message); } finally { setBusy(false); }
  }

  async function resetPassword() {
    if (!/^\d{6}$/.test(code.trim())) { popup.warn('Enter the code', 'The code has 6 digits.'); return; }
    if (pw.length < 8) { popup.warn('Password too short', 'Use at least 8 characters.'); return; }
    setBusy(true);
    try {
      await api('POST', '/auth/reset-password', { email, code: code.trim(), newPassword: pw });
      popup.success('Password updated!', 'You can now log in with your new password.', { emoji: '🔐' });
      navigation.goBack();
    } catch (e: any) { popup.error(e.message, 'Could not reset password'); } finally { setBusy(false); }
  }

  const slide = { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24 }} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (step === 'reset' ? setStep('email') : navigation.goBack())} style={forgotStyles.back}>
          <Text style={forgotStyles.backText}>‹</Text>
        </Pressable>
        <Animated.View style={slide}>
          <View style={forgotStyles.badge}><Text style={forgotStyles.badgeText}>{step === 'email' ? '🔒' : '📨'}</Text></View>
          <Text style={forgotStyles.title}>{step === 'email' ? 'Reset your password' : 'Check your email'}</Text>
          <Text style={forgotStyles.sub}>
            {step === 'email'
              ? 'Enter your email and we will send you a code to choose a new password.'
              : `Enter the 6-digit code we sent to ${email} and choose a new password.`}
          </Text>

          {step === 'email' ? (
            <>
              <Text style={s.label}>Email ID</Text>
              <TextInput style={field('email')} placeholder="name@school.in" placeholderTextColor="#a6a6a6" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} onFocus={() => setFocus('email')} onBlur={() => setFocus(null)} editable={!busy} />
              <Button label="Send reset code" busy={busy} onPress={sendCode} />
              <View style={forgotStyles.note}>
                <Text style={forgotStyles.noteIcon}>🛡️</Text>
                <Text style={forgotStyles.noteText}>If this email is registered, a reset code is on its way. Check your spam folder too.</Text>
              </View>
            </>
          ) : (
            <>
              <Text style={s.label}>Reset code</Text>
              <TextInput style={[...field('code'), forgotStyles.codeInput]} placeholder="······" placeholderTextColor="#c4c4c4" keyboardType="number-pad" maxLength={6} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ''))} onFocus={() => setFocus('code')} onBlur={() => setFocus(null)} editable={!busy} />
              <Text style={[s.label, { marginTop: 14 }]}>New password</Text>
              <View>
                <TextInput style={[...field('pw'), { paddingRight: 44 }]} placeholder="At least 8 characters" placeholderTextColor="#a6a6a6" secureTextEntry={!showPw} value={pw} onChangeText={setPw} onFocus={() => setFocus('pw')} onBlur={() => setFocus(null)} editable={!busy} />
                <Pressable accessibilityRole="button" accessibilityLabel={showPw ? 'Hide password' : 'Show password'} onPress={() => setShowPw((v) => !v)} style={loginStyles.eye}>
                  <Text style={loginStyles.eyeText}>{showPw ? '🙈' : '👁'}</Text>
                </Pressable>
              </View>
              <View style={forgotStyles.meter}>
                {[0, 1, 2, 3].map((i) => <View key={i} style={[forgotStyles.meterBar, i < strength && { backgroundColor: strengthColor }]} />)}
              </View>
              <Text style={forgotStyles.hint}>{pw ? (strength >= 4 ? 'Strong' : strength >= 2 ? 'Getting there' : 'Weak') : 'Add a number, a capital letter and a symbol for a stronger password.'}</Text>
              <Button label="Save and continue" busy={busy} onPress={resetPassword} />
              <Pressable onPress={sendCode} disabled={busy} style={forgotStyles.resend}><Text style={forgotStyles.resendText}>Didn’t get it? Send a new code</Text></Pressable>
            </>
          )}
          <Pressable onPress={() => navigation.goBack()} style={forgotStyles.resend}><Text style={forgotStyles.backLink}>Back to login</Text></Pressable>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const forgotStyles = {
  back: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: 18 },
  backText: { fontSize: 24, color: colors.text, lineHeight: 28 },
  badge: { width: 56, height: 56, borderRadius: 16, backgroundColor: '#fff3c9', alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: 16 },
  badgeText: { fontSize: 26 },
  title: { color: colors.text, fontSize: 25, fontWeight: '800' as const },
  sub: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 20 },
  note: { flexDirection: 'row' as const, backgroundColor: '#e8f6ef', borderRadius: 12, padding: 12, marginTop: 6 },
  noteIcon: { fontSize: 16, marginRight: 8 },
  noteText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 17 },
  codeInput: { fontSize: 22, letterSpacing: 8, textAlign: 'center' as const, fontWeight: '800' as const },
  meter: { flexDirection: 'row' as const, gap: 6, marginTop: 10 },
  meterBar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#ece8e2' },
  hint: { color: colors.muted, fontSize: 11, marginTop: 6, marginBottom: 6 },
  resend: { alignItems: 'center' as const, paddingVertical: 12 },
  resendText: { color: colors.primary, fontSize: 13, fontWeight: '700' as const },
  backLink: { color: colors.muted, fontSize: 13, fontWeight: '600' as const },
};

export function RegisterSchoolScreen({ navigation }: any) {
  const popup = usePopup();
  return (
    <FormScreen
      submitLabel="Submit for verification"
      fields={[
        { key: 'name', label: 'School name' }, { key: 'address', label: 'Address' }, { key: 'city', label: 'City' },
        { key: 'phone', label: 'School phone', kind: 'phone' }, { key: 'email', label: 'Principal email', kind: 'email' },
        { key: 'principalName', label: 'Principal name' }, { key: 'registrationNo', label: 'Registration no.', required: false },
      ]}
      submit={(b) => api('POST', '/schools/register', b)}
      onDone={() => {
        popup.success('Application received!', 'You will receive your login by email once the school is verified.', { emoji: '📩', duration: 3400 });
        navigation.goBack();
      }}
    />
  );
}

export function ChangePasswordScreen() {
  const { passwordChanged, logout } = useAuth();
  return (
    <FormScreen
      intro="For your security, please choose a new password before continuing."
      submitLabel="Set password"
      fields={[{ key: 'newPassword', label: 'New password (min 8 characters)', kind: 'password' }]}
      submit={(b) => api('POST', '/auth/change-password', b)}
      onDone={() => { passwordChanged(); }}
    />
  );
}

export function ProfileScreen() {
  const { session, logout } = useAuth();
  const popup = usePopup();
  return (
    <Page>
      <ScreenHeader title="Your profile" subtitle="Your current school account and access role." icon="👤" />
      <Card><Title>{session?.user.name}</Title><Sub>{session?.user.role.replaceAll('_', ' ')}</Sub></Card>
      <Button label="Sign out" secondary onPress={async () => { if (await popup.confirm('Sign out?', 'You can sign back in with your school account.', 'Sign out')) await logout(); }} />
    </Page>
  );
}

const ICON: Record<string, string> = { HOMEWORK: '📚', EVENT: '🎉', FEE: '💰', PICKUP: '🚸', ATTENDANCE: '🗓️', MEDIA: '📷', GENERAL: '📢' };
const APPROVAL_MESSAGE = 'Welcome to TinySteps! Your school has been approved. Below you will find your login ID and a temporary password. Please sign in and set a new password. We are happy to help you get started.';
export function NotificationsScreen() {
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const popup = usePopup();
  return (
    <ListScreen<any> key={version} path="/me/notifications" empty="No notifications yet" countLabel="recent alerts"
      searchText={(notification) => `${notification.title} ${notification.body} ${notification.type}`}
      filters={[{ label: 'Read status', value: (notification) => notification.readAt ? 'Read' : 'Unread' }, { label: 'Category', value: (notification) => notification.type }]}
      header={<><ScreenHeader title="Your alerts" subtitle="Search your latest 100 notifications and keep track of unread updates." icon="🔔" />
        <Button label="Mark all as read" secondary busy={busy} onPress={async () => {
          if (busy) return;
          setBusy(true);
          try { await api('POST', '/me/notifications/read-all', {}); setVersion((previous) => previous + 1); popup.success('All alerts marked as read'); }
          catch (error: any) { popup.error(error.message); }
          finally { setBusy(false); }
        }} /></>}
      render={(n) => (
        <Card>
          <Title>{ICON[n.type] ?? '🔔'} {n.title}</Title><Sub>{n.body}</Sub><Sub>{day(n.createdAt)}</Sub>
          {!n.readAt ? <Badge text="NEW" color={colors.primary} /> : null}
        </Card>
      )} />
  );
}

export function SuperAdminHome() {
  const { logout } = useAuth();
  const { data, err, reload } = useFetch<any[]>('/admin/schools');
  const [status, setStatus] = useState('PENDING');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<any | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const schools = data ?? [];
  const counts = {
    PENDING: schools.filter((school) => school.status === 'PENDING').length,
    APPROVED: schools.filter((school) => school.status === 'APPROVED').length,
    SUSPENDED: schools.filter((school) => school.status === 'SUSPENDED').length,
    REJECTED: schools.filter((school) => school.status === 'REJECTED').length,
  };
  const visibleSchools = schools.filter((school) => {
    if (school.status !== status) return false;
    const needle = query.trim().toLowerCase();
    return !needle || [school.name, school.city, school.principalName, school.email].some((value) => value?.toLowerCase().includes(needle));
  });

  async function refresh() {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  }

  return (
    <View style={adminStyles.screen}>
      <ScrollView
        contentContainerStyle={adminStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      >
        <View style={adminStyles.topRow}>
          <View style={adminStyles.headingGroup}>
            <Text style={adminStyles.eyebrow}>SCHOOL MANAGEMENT</Text>
            <Text style={adminStyles.screenTitle}>Registrations</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={logout} style={adminStyles.signOut}>
            <Text style={adminStyles.signOutText}>Sign out</Text>
          </Pressable>
        </View>

        <View style={adminStyles.searchBox}>
          <Text style={adminStyles.searchIcon}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search school or city"
            placeholderTextColor="#9ba1a6"
            style={adminStyles.searchInput}
            returnKeyType="search"
            accessibilityLabel="Search schools"
          />
          {query.length > 0 ? <Pressable onPress={() => setQuery('')}><Text style={adminStyles.clearSearch}>×</Text></Pressable> : null}
        </View>

        <View style={adminStyles.statusTabs}>
          {(['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED'] as const).map((item) => (
            <Pressable
              key={item}
              accessibilityRole="tab"
              accessibilityState={{ selected: status === item }}
              onPress={() => setStatus(item)}
              style={[adminStyles.statusTab, status === item && adminStyles.statusTabActive]}
            >
              <Text style={[adminStyles.statusTabText, status === item && adminStyles.statusTabTextActive]} numberOfLines={1}>
                {STATUS_TAB[item]} <Text style={[adminStyles.count, status === item && adminStyles.countActive]}>{counts[item]}</Text>
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={adminStyles.listHeading}>
          <Text style={adminStyles.listTitle}>{status === 'PENDING' ? 'Needs review' : status === 'APPROVED' ? 'Approved schools' : status === 'SUSPENDED' ? 'Inactive schools' : 'Rejected applications'}</Text>
          <Text style={adminStyles.listCount}>{visibleSchools.length} total</Text>
        </View>

        {err ? <Text style={s.err}>{err}</Text> : null}
        {!data && !err ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : null}
        {data && visibleSchools.map((school) => {
          const initials = school.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part: string) => part[0]).join('').toUpperCase();
          return (
            <Pressable key={school.id} onPress={() => setSelected(school)} style={({ pressed }) => [adminStyles.schoolCard, pressed && adminStyles.pressed]}>
              <View style={[adminStyles.schoolAvatar, { backgroundColor: avatarColor(school.name) }]}>
                <Text style={adminStyles.schoolAvatarText}>{initials}</Text>
              </View>
              <View style={adminStyles.schoolInfo}>
                <Text style={adminStyles.schoolName}>{school.name}</Text>
                <Text style={adminStyles.schoolMeta}>{school.city} · {school.principalName}</Text>
                <Text style={adminStyles.schoolTime}>{school.email}</Text>
              </View>
              <View style={[adminStyles.statusBadge, statusBadgeStyle(school.status)]}>
                <Text style={[adminStyles.statusBadgeText, { color: statusTextColor(school.status) }]}>{statusLabel(school.status)}</Text>
              </View>
            </Pressable>
          );
        })}
        {data && visibleSchools.length === 0 ? (
          <View style={adminStyles.emptyState}>
            <Text style={adminStyles.emptyIcon}>{query ? '⌕' : '✓'}</Text>
            <Text style={adminStyles.emptyTitle}>{query ? 'No matching schools' : status === 'PENDING' ? 'All caught up!' : 'Nothing to show yet'}</Text>
            <Text style={adminStyles.emptyText}>{query ? 'Try another school name or city.' : status === 'PENDING' ? 'New school applications will appear here.' : `There are no ${status.toLowerCase()} applications.`}</Text>
          </View>
        ) : null}
      </ScrollView>

      <SchoolSheet school={selected} onClose={() => setSelected(null)} onChanged={reload} />
    </View>
  );
}

const STATUS_TAB: Record<string, string> = { PENDING: 'Pending', APPROVED: 'Approved', SUSPENDED: 'Inactive', REJECTED: 'Rejected' };
const fullDate = (d: string | Date) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const HISTORY_TITLE: Record<string, string> = { APPROVED: 'Approved', REJECTED: 'Rejected', SUSPENDED: 'Deactivated', PENDING: 'Pending' };
const HISTORY_COLOR: Record<string, string> = { APPROVED: colors.primary, REJECTED: colors.bad, SUSPENDED: '#ad7b0c', PENDING: colors.muted };
const REACTIVATE_MESSAGE = 'Your school account has been reactivated. You can sign in again with your existing login.';

type SheetMode = 'view' | 'APPROVE' | 'REJECT' | 'SUSPEND';
type Outcome = { variant: 'success' | 'danger' | 'warning'; title: string; subtitle?: string; credentials?: { login: string; password: string } };

// Shared by the Requests and Schools tabs: details, status history and every status change.
function SchoolSheet({ school, onClose, onChanged }: { school: any | null; onClose: () => void; onChanged: () => Promise<unknown> | void }) {
  const [current, setCurrent] = useState<any | null>(school);
  const [mode, setMode] = useState<SheetMode>('view');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<any[] | null>(null);
  const [credentials, setCredentials] = useState<Outcome['credentials'] | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  const popup = usePopup();

  // Reset the sheet whenever a different school is opened.
  if (school && school.id !== lastId) {
    setLastId(school.id);
    setCurrent(school);
    setMode('view');
    setError('');
    setHistory(null);
  }

  function close() {
    setLastId(null);
    onClose();
  }

  const id = school?.id;
  useEffect(() => {
    if (!id) return;
    let live = true;
    api('GET', `/admin/schools/${id}/history`).then((rows) => { if (live) setHistory(rows); }).catch(() => { if (live) setHistory([]); });
    return () => { live = false; };
  }, [id]);

  function open(next: SheetMode) {
    setError('');
    setMode(next);
    if (next === 'APPROVE') setMessage(current?.approvedAt ? REACTIVATE_MESSAGE : APPROVAL_MESSAGE);
    else if (next === 'REJECT') setMessage(current?.status === 'PENDING' ? 'Could not verify school details' : '');
    else setMessage('');
  }

  async function submit() {
    if (!current || mode === 'view') return;
    const text = message.trim();
    if (mode === 'APPROVE' && !text) { setError('Enter a message for the school.'); return; }
    if (mode !== 'APPROVE' && text.length < 3) { setError('Enter a reason with at least 3 characters.'); return; }
    setBusy(true);
    setError('');
    try {
      let next: Outcome;
      if (mode === 'APPROVE') {
        const result = await api('POST', `/admin/schools/${current.id}/approve`, { message: text });
        next = result.reactivated
          ? { variant: 'success', title: 'School Reactivated Successfully!', subtitle: `${current.name} can sign in again.` }
          : {
            variant: 'success', title: 'School Approved Successfully!',
            subtitle: result.emailSent ? `Login details were emailed to ${result.login}.` : undefined,
            credentials: result.emailSent ? undefined : { login: result.login, password: result.temporaryPassword },
          };
      } else if (mode === 'REJECT') {
        await api('POST', `/admin/schools/${current.id}/reject`, { reason: text });
        next = { variant: 'danger', title: 'School Rejected.', subtitle: current.name };
      } else {
        await api('POST', `/admin/schools/${current.id}/suspend`, { reason: text });
        next = { variant: 'warning', title: 'School Deactivated.', subtitle: `${current.name} can no longer sign in.` };
      }
      setMode('view');
      close();
      popup.show({ ...next, onHidden: next.credentials ? () => setCredentials(next.credentials) : undefined });
      await onChanged();
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const status = current?.status;
  const copy = {
    APPROVE: { title: current?.approvedAt ? 'Reactivate school' : 'Approve school', hint: current?.approvedAt ? 'The existing principal login is restored. No new password is issued.' : `This message will be sent to ${current?.email}.`, label: current?.approvedAt ? 'MESSAGE (SAVED IN HISTORY)' : 'MESSAGE TO THE SCHOOL', action: current?.approvedAt ? 'Reactivate' : 'Send approval' },
    REJECT: { title: 'Reject school', hint: 'The school will be blocked from signing in. You can approve it again later.', label: 'REASON FOR REJECTION', action: 'Confirm rejection' },
    SUSPEND: { title: 'Deactivate school', hint: 'Use this when a school closes or must be paused. Users will be unable to sign in until it is reactivated.', label: 'REASON FOR DEACTIVATION', action: 'Deactivate school' },
  } as const;

  return (
    <>
      <Modal visible={!!school} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={adminStyles.modalBackdrop} onPress={close}>
          <Pressable style={adminStyles.sheet} onPress={(event) => event.stopPropagation()}>
            <View style={adminStyles.sheetHandle} />
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {current ? mode !== 'view' ? (
                <>
                  <Text style={adminStyles.sheetTitle}>{copy[mode].title}</Text>
                  <Text style={adminStyles.sheetDescription}>{current.name}{'\n'}{copy[mode].hint}</Text>
                  <Text style={adminStyles.messageLabel}>{copy[mode].label}</Text>
                  <TextInput
                    style={[adminStyles.messageInput, !!error && adminStyles.inputError]}
                    value={message}
                    onChangeText={(t) => { setMessage(t); setError(''); }}
                    multiline
                    textAlignVertical="top"
                    maxLength={1200}
                    accessibilityLabel={copy[mode].label}
                  />
                  {error ? <Text style={adminStyles.inlineError}>{error}</Text> : null}
                  {mode === 'APPROVE' && !current.approvedAt ? (
                    <View style={adminStyles.automaticNote}>
                      <Text style={adminStyles.automaticIcon}>♙</Text>
                      <Text style={adminStyles.automaticText}>Login ID and temporary password are added automatically.</Text>
                    </View>
                  ) : null}
                  <View style={adminStyles.sheetActions}>
                    <View style={adminStyles.actionHalf}><Button label="Back" secondary onPress={() => { setMode('view'); setError(''); }} /></View>
                    <View style={adminStyles.actionGap} />
                    <View style={adminStyles.actionHalf}>
                      <Button label={copy[mode].action} busy={busy} danger={mode !== 'APPROVE'} onPress={submit} />
                    </View>
                  </View>
                </>
              ) : (
                <>
                  <View style={adminStyles.reviewHeader}>
                    <View style={[adminStyles.schoolAvatar, adminStyles.reviewAvatar, { backgroundColor: avatarColor(current.name) }]}>
                      <Text style={adminStyles.schoolAvatarText}>{current.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part: string) => part[0]).join('').toUpperCase()}</Text>
                    </View>
                    <View style={adminStyles.reviewHeading}>
                      <Text style={adminStyles.schoolName}>{current.name}</Text>
                      <Text style={adminStyles.schoolTime}>Submitted {fullDate(current.createdAt)}</Text>
                    </View>
                    <View style={[adminStyles.statusBadge, statusBadgeStyle(status)]}>
                      <Text style={[adminStyles.statusBadgeText, { color: statusTextColor(status) }]}>{statusLabel(status)}</Text>
                    </View>
                  </View>

                  {current.approvedAt ? (
                    <View style={adminStyles.startCard}>
                      <Text style={adminStyles.startIcon}>★</Text>
                      <View style={adminStyles.detailContent}>
                        <Text style={adminStyles.startLabel}>FIRST APPROVED · OFFICIAL START</Text>
                        <Text style={adminStyles.startValue}>{fullDate(current.approvedAt)}</Text>
                      </View>
                    </View>
                  ) : null}
                  {current.statusChangedAt && status !== 'PENDING' ? (
                    <Text style={adminStyles.sinceText}>Current status since {fullDate(current.statusChangedAt)}</Text>
                  ) : null}
                  {current.rejectReason && status !== 'APPROVED' ? (
                    <View style={adminStyles.reasonBox}>
                      <Text style={adminStyles.reasonLabel}>{status === 'SUSPENDED' ? 'DEACTIVATION REASON' : 'REJECTION REASON'}</Text>
                      <Text style={adminStyles.reasonText}>{current.rejectReason}</Text>
                    </View>
                  ) : null}

                  <Text style={adminStyles.detailsLabel}>SCHOOL DETAILS</Text>
                  <View style={adminStyles.detailsCard}>
                    <SchoolDetail label="Principal" value={current.principalName} icon="♙" />
                    <SchoolDetail label="Contact" value={current.phone} icon="⌕" />
                    <SchoolDetail label="Email" value={current.email} icon="✉" />
                    <SchoolDetail label="Address" value={`${current.address}, ${current.city}`} icon="⌖" last={!current.registrationNo} />
                    {current.registrationNo ? <SchoolDetail label="Registration number" value={current.registrationNo} icon="№" last /> : null}
                  </View>

                  <Text style={adminStyles.detailsLabel}>STATUS HISTORY</Text>
                  <View style={adminStyles.detailsCard}>
                    {history === null ? <ActivityIndicator color={colors.primary} style={{ margin: 14 }} /> : null}
                    {history?.length === 0 ? <Text style={adminStyles.historyEmpty}>No status changes recorded yet.</Text> : null}
                    {history?.map((entry, index) => (
                      <View key={entry.id} style={[adminStyles.historyRow, index === history.length - 1 && adminStyles.detailRowLast]}>
                        <View style={[adminStyles.historyDot, { backgroundColor: HISTORY_COLOR[entry.toStatus] ?? colors.muted }]} />
                        <View style={adminStyles.detailContent}>
                          <Text style={adminStyles.historyTitle}>
                            {HISTORY_TITLE[entry.toStatus] ?? entry.toStatus}
                            {entry.toStatus === 'APPROVED' && entry.fromStatus === 'PENDING' ? '  ·  First approval' : ''}
                            {entry.toStatus === 'APPROVED' && entry.fromStatus !== 'PENDING' ? '  ·  Reactivated' : ''}
                          </Text>
                          <Text style={adminStyles.historyMeta}>{fullDate(entry.createdAt)} · by {entry.adminName}</Text>
                          {entry.reason ? <Text style={adminStyles.historyReason} numberOfLines={3}>{entry.reason}</Text> : null}
                        </View>
                      </View>
                    ))}
                  </View>

                  {status === 'PENDING' ? (
                    <View style={adminStyles.sheetActions}>
                      <View style={adminStyles.actionHalf}><Button label="Reject" secondary danger onPress={() => open('REJECT')} /></View>
                      <View style={adminStyles.actionGap} />
                      <View style={adminStyles.actionHalf}><Button label="Approve" onPress={() => open('APPROVE')} /></View>
                    </View>
                  ) : null}
                  {status === 'APPROVED' ? (
                    <View style={adminStyles.sheetActions}>
                      <View style={adminStyles.actionHalf}><Button label="Reject" secondary danger onPress={() => open('REJECT')} /></View>
                      <View style={adminStyles.actionGap} />
                      <View style={adminStyles.actionHalf}><Button label="Deactivate" danger onPress={() => open('SUSPEND')} /></View>
                    </View>
                  ) : null}
                  {status === 'SUSPENDED' ? (
                    <View style={adminStyles.sheetActions}>
                      <View style={adminStyles.actionHalf}><Button label="Reject" secondary danger onPress={() => open('REJECT')} /></View>
                      <View style={adminStyles.actionGap} />
                      <View style={adminStyles.actionHalf}><Button label="Reactivate" onPress={() => open('APPROVE')} /></View>
                    </View>
                  ) : null}
                  {status === 'REJECTED' ? <Button label={current.approvedAt ? 'Reactivate' : 'Approve'} onPress={() => open('APPROVE')} /> : null}
                  <Button label="Close" secondary onPress={close} />
                </>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!credentials} transparent animationType="fade" onRequestClose={() => setCredentials(null)}>
        <View style={adminStyles.credBackdrop}>
          <View style={adminStyles.credCard}>
            <Text style={adminStyles.sheetTitle}>Share these login details</Text>
            <Text style={adminStyles.sheetDescription}>Email is not configured, so send these to the principal yourself. The password is shown only once.</Text>
            <Text style={adminStyles.messageLabel}>LOGIN ID</Text>
            <Text selectable style={adminStyles.credValue}>{credentials?.login}</Text>
            <Text style={adminStyles.messageLabel}>TEMPORARY PASSWORD</Text>
            <Text selectable style={adminStyles.credValue}>{credentials?.password}</Text>
            <Button label="Done" onPress={() => setCredentials(null)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

function SchoolDetail({ label, value, icon, last }: { label: string; value: string; icon: string; last?: boolean }) {
  return (
    <View style={[adminStyles.detailRow, last && adminStyles.detailRowLast]}>
      <Text style={adminStyles.detailIcon}>{icon}</Text>
      <View style={adminStyles.detailContent}>
        <Text style={adminStyles.detailLabel}>{label}</Text>
        <Text style={adminStyles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

function avatarColor(name: string) {
  const palette = ['#2e9e82', '#5798dc', '#8a78d4', '#dfa818', '#df7168'];
  return palette[name.charCodeAt(0) % palette.length];
}

function statusLabel(status: string) {
  return status === 'SUSPENDED' ? 'Inactive' : status[0] + status.slice(1).toLowerCase();
}

function statusBadgeStyle(status: string) {
  if (status === 'APPROVED') return { backgroundColor: '#e8f6ef' };
  if (status === 'REJECTED') return { backgroundColor: '#fff0ed' };
  return { backgroundColor: '#fff5d9' };
}

function statusTextColor(status: string) {
  if (status === 'APPROVED') return colors.primary;
  if (status === 'REJECTED') return colors.bad;
  return '#ad7b0c';
}

const adminStyles = {
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 28 },
  topRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 18 },
  headingGroup: { gap: 3 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '800' as const, letterSpacing: 1.1 },
  screenTitle: { color: colors.text, fontSize: 26, fontWeight: '800' as const },
  signOut: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  signOutText: { color: colors.primary, fontSize: 12, fontWeight: '700' as const },
  searchBox: { minHeight: 48, flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', marginBottom: 14 },
  searchIcon: { fontSize: 24, color: colors.muted, marginRight: 9, lineHeight: 28 },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 10 },
  clearSearch: { color: colors.muted, fontSize: 22, paddingLeft: 8 },
  statusTabs: { flexDirection: 'row' as const, backgroundColor: '#f1f0ed', borderRadius: 13, padding: 4, marginBottom: 22 },
  statusTab: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: 10, paddingVertical: 10 },
  statusTabActive: { backgroundColor: '#fff', elevation: 1 },
  statusTabText: { color: colors.muted, fontSize: 12, fontWeight: '600' as const },
  statusTabTextActive: { color: colors.text },
  count: { color: colors.muted, fontWeight: '700' as const },
  countActive: { color: colors.primary },
  listHeading: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: 10 },
  listTitle: { color: colors.text, fontSize: 16, fontWeight: '800' as const },
  listCount: { color: colors.muted, fontSize: 12 },
  schoolCard: { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: '#fff', borderRadius: 17, borderWidth: 1, borderColor: colors.border, padding: 13, marginBottom: 10, elevation: 1, shadowColor: '#3c342c', shadowOpacity: 0.04, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  schoolAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center' as const, justifyContent: 'center' as const, marginRight: 11 },
  schoolAvatarText: { color: '#fff', fontSize: 13, fontWeight: '800' as const },
  schoolInfo: { flex: 1, paddingRight: 7 },
  schoolName: { color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '800' as const },
  schoolMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  schoolTime: { color: colors.muted, fontSize: 10, marginTop: 3 },
  statusBadge: { borderRadius: 9, paddingHorizontal: 8, paddingVertical: 5 },
  statusBadgeText: { fontSize: 9, fontWeight: '800' as const },
  emptyState: { alignItems: 'center' as const, paddingHorizontal: 28, paddingTop: 42 },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, overflow: 'hidden' as const, textAlign: 'center' as const, textAlignVertical: 'center' as const, backgroundColor: '#e8f6ef', color: colors.primary, fontSize: 30, marginBottom: 12 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '800' as const },
  emptyText: { color: colors.muted, fontSize: 13, textAlign: 'center' as const, lineHeight: 19, marginTop: 5 },
  modalBackdrop: { flex: 1, backgroundColor: '#1e2b2480', justifyContent: 'flex-end' as const },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, maxHeight: '88%' as const },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center' as const, backgroundColor: '#d4d8d4', marginBottom: 17 },
  reviewHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: '#fff', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 18 },
  reviewAvatar: { width: 42, height: 42 },
  reviewHeading: { flex: 1, paddingRight: 6 },
  detailsLabel: { color: colors.text, fontSize: 11, fontWeight: '800' as const, letterSpacing: 0.7, marginBottom: 8 },
  detailsCard: { backgroundColor: '#fff', borderRadius: 17, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, paddingVertical: 2, marginBottom: 12 },
  detailRow: { flexDirection: 'row' as const, alignItems: 'center' as const, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 11 },
  detailRowLast: { borderBottomWidth: 0 },
  detailIcon: { width: 26, color: colors.muted, fontSize: 18, textAlign: 'center' as const, marginRight: 9 },
  detailContent: { flex: 1 },
  detailLabel: { color: colors.muted, fontSize: 10, marginBottom: 2 },
  detailValue: { color: colors.text, fontSize: 12, fontWeight: '700' as const, lineHeight: 17 },
  sheetEyebrow: { color: colors.primary, fontSize: 10, fontWeight: '800' as const, letterSpacing: 1, marginBottom: 6 },
  sheetTitle: { color: colors.text, fontSize: 21, fontWeight: '800' as const, lineHeight: 27 },
  sheetDescription: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 9, marginBottom: 18 },
  decisionTabs: { flexDirection: 'row' as const, backgroundColor: '#ecefed', borderRadius: 12, padding: 4, marginBottom: 18 },
  decisionTab: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: 9, paddingVertical: 10 },
  decisionTabActive: { backgroundColor: '#fff', elevation: 1 },
  decisionTabText: { color: colors.muted, fontSize: 12, fontWeight: '700' as const },
  decisionTabTextActive: { color: colors.text },
  messageLabel: { color: colors.text, fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.6, marginBottom: 7 },
  messageInput: { minHeight: 112, maxHeight: 190, borderWidth: 1, borderColor: colors.border, borderRadius: 13, backgroundColor: '#fff', color: colors.text, padding: 12, fontSize: 12, lineHeight: 18 },
  automaticNote: { flexDirection: 'row' as const, alignItems: 'center' as const, marginTop: 9, marginBottom: 6 },
  automaticIcon: { color: colors.primary, fontSize: 14, marginRight: 7 },
  automaticText: { flex: 1, color: colors.muted, fontSize: 10, lineHeight: 15 },
  sheetActions: { flexDirection: 'row' as const, alignItems: 'center' as const, marginTop: 2 },
  actionHalf: { flex: 1 },
  actionGap: { width: 10 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  inputError: { borderColor: colors.bad },
  inlineError: { color: colors.bad, fontSize: 12, marginTop: 7 },
  startCard: { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: '#e8f6ef', borderRadius: 15, borderWidth: 1, borderColor: '#bfe3d1', padding: 13, marginBottom: 8 },
  startIcon: { color: colors.primary, fontSize: 22, width: 32 },
  startLabel: { color: colors.primary, fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.8 },
  startValue: { color: colors.text, fontSize: 14, fontWeight: '800' as const, marginTop: 3 },
  sinceText: { color: colors.muted, fontSize: 11, marginBottom: 12, marginLeft: 4 },
  reasonBox: { backgroundColor: '#fff5f3', borderRadius: 13, borderWidth: 1, borderColor: '#f6d4cf', padding: 12, marginBottom: 14 },
  reasonLabel: { color: colors.bad, fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.7, marginBottom: 4 },
  reasonText: { color: colors.text, fontSize: 12, lineHeight: 18 },
  historyRow: { flexDirection: 'row' as const, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 11 },
  historyDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, marginRight: 12, marginLeft: 3 },
  historyTitle: { color: colors.text, fontSize: 12, fontWeight: '800' as const },
  historyMeta: { color: colors.muted, fontSize: 10, marginTop: 2 },
  historyReason: { color: colors.text, fontSize: 11, lineHeight: 16, marginTop: 4 },
  historyEmpty: { color: colors.muted, fontSize: 12, paddingVertical: 14, textAlign: 'center' as const },
  credBackdrop: { flex: 1, backgroundColor: '#1e2b2499', justifyContent: 'center' as const, padding: 24 },
  credCard: { backgroundColor: '#fff', borderRadius: 22, padding: 22 },
  credValue: { color: colors.text, fontSize: 16, fontWeight: '800' as const, marginBottom: 16, backgroundColor: colors.bg, borderRadius: 10, padding: 10 },
};

export function SuperAdminSchools() {
  const { data, err, reload } = useFetch<any[]>('/admin/schools');
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('APPROVED');
  const [selected, setSelected] = useState<any | null>(null);

  async function refresh() {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  }

  const shown = (data ?? []).filter((school) => school.status === filter);

  return (
    <View style={adminStyles.screen}>
      <ScrollView
        contentContainerStyle={adminStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      >
        <Text style={adminStyles.eyebrow}>SCHOOL MANAGEMENT</Text>
        <Text style={[adminStyles.screenTitle, { marginBottom: 18 }]}>Schools</Text>
        <View style={adminStyles.statusTabs}>
          {(['APPROVED', 'SUSPENDED', 'REJECTED'] as const).map((item) => (
            <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: filter === item }} onPress={() => setFilter(item)}
              style={[adminStyles.statusTab, filter === item && adminStyles.statusTabActive]}>
              <Text style={[adminStyles.statusTabText, filter === item && adminStyles.statusTabTextActive]}>
                {item === 'APPROVED' ? 'Active' : STATUS_TAB[item]} <Text style={[adminStyles.count, filter === item && adminStyles.countActive]}>{(data ?? []).filter((school) => school.status === item).length}</Text>
              </Text>
            </Pressable>
          ))}
        </View>
        {err ? <Text style={s.err}>{err}</Text> : null}
        {!data && !err ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : null}
        {shown.map((school) => {
          const initials = school.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part: string) => part[0]).join('').toUpperCase();
          return (
            <Pressable key={school.id} onPress={() => setSelected(school)} style={({ pressed }) => [adminStyles.schoolCard, pressed && adminStyles.pressed]}>
              <View style={[adminStyles.schoolAvatar, { backgroundColor: avatarColor(school.name) }]}>
                <Text style={adminStyles.schoolAvatarText}>{initials}</Text>
              </View>
              <View style={adminStyles.schoolInfo}>
                <Text style={adminStyles.schoolName}>{school.name}</Text>
                <Text style={adminStyles.schoolMeta}>{school.city} · {school.principalName}</Text>
                <Text style={adminStyles.schoolTime}>{school.approvedAt ? `Started ${fullDate(school.approvedAt)}` : school.email}</Text>
              </View>
              <View style={[adminStyles.statusBadge, statusBadgeStyle(school.status)]}>
                <Text style={[adminStyles.statusBadgeText, { color: statusTextColor(school.status) }]}>{school.status === 'APPROVED' ? 'Active' : statusLabel(school.status)}</Text>
              </View>
            </Pressable>
          );
        })}
        {data && shown.length === 0 ? (
          <View style={adminStyles.emptyState}>
            <Text style={adminStyles.emptyIcon}>⌂</Text>
            <Text style={adminStyles.emptyTitle}>No {filter === 'APPROVED' ? 'active' : STATUS_TAB[filter].toLowerCase()} schools</Text>
            <Text style={adminStyles.emptyText}>Schools with this status will appear here.</Text>
          </View>
        ) : null}
      </ScrollView>
      <SchoolSheet school={selected} onClose={() => setSelected(null)} onChanged={reload} />
    </View>
  );
}

export function AdminAuditLogScreen() {
  const { data, err, reload } = useFetch<any[]>('/admin/status-log');
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  }

  return (
    <View style={adminStyles.screen}>
      <ScrollView
        contentContainerStyle={adminStyles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      >
        <Text style={adminStyles.eyebrow}>SCHOOL MANAGEMENT</Text>
        <Text style={[adminStyles.screenTitle, { marginBottom: 18 }]}>Audit log</Text>
        {err ? <Text style={s.err}>{err}</Text> : null}
        {!data && !err ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : null}
        {data?.map((entry) => {
          const firstApproval = entry.toStatus === 'APPROVED' && entry.fromStatus === 'PENDING';
          const title = firstApproval ? 'First approval' : entry.toStatus === 'APPROVED' ? 'Reactivated' : HISTORY_TITLE[entry.toStatus] ?? entry.toStatus;
          return (
            <View key={entry.id} style={adminStyles.schoolCard}>
              <View style={[adminStyles.historyDot, { backgroundColor: HISTORY_COLOR[entry.toStatus] ?? colors.muted, marginLeft: 0 }]} />
              <View style={adminStyles.schoolInfo}>
                <Text style={adminStyles.schoolName}>{entry.school?.name ?? 'School'} · {title}</Text>
                <Text style={adminStyles.schoolMeta}>{fullDate(entry.createdAt)} · by {entry.adminName}</Text>
                {entry.reason ? <Text style={adminStyles.schoolTime} numberOfLines={2}>{entry.reason}</Text> : null}
              </View>
            </View>
          );
        })}
        {data?.length === 0 ? (
          <View style={adminStyles.emptyState}>
            <Text style={adminStyles.emptyIcon}>▤</Text>
            <Text style={adminStyles.emptyTitle}>No activity yet</Text>
            <Text style={adminStyles.emptyText}>Approvals, rejections and deactivations are recorded here.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
