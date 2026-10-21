import React, { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Button, Card, FormScreen, ListScreen, Sub, Title, colors, day, s } from '../ui';

export function LoginScreen({ navigation }: any) {
  const { login } = useAuth();
  const [id, setId] = useState(''); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: colors.bg }}>
      <Text style={{ fontSize: 28, fontWeight: '800', color: colors.primary, marginBottom: 24 }}>🌈 TinySteps</Text>
      <TextInput style={[s.input, { marginBottom: 12 }]} placeholder="Email or phone" autoCapitalize="none" value={id} onChangeText={setId} />
      <TextInput style={[s.input, { marginBottom: 12 }]} placeholder="Password" secureTextEntry value={pw} onChangeText={setPw} />
      <Button label="Sign in" busy={busy} onPress={async () => {
        setBusy(true);
        try { await login(id.trim(), pw); } catch (e: any) { Alert.alert('Login failed', e.message); } finally { setBusy(false); }
      }} />
      <Button label="Register your school" secondary onPress={() => navigation.navigate('RegisterSchool')} />
    </View>
  );
}

export function RegisterSchoolScreen({ navigation }: any) {
  return (
    <FormScreen
      submitLabel="Submit for verification"
      fields={[
        { key: 'name', label: 'School name' }, { key: 'address', label: 'Address' }, { key: 'city', label: 'City' },
        { key: 'phone', label: 'School phone', kind: 'phone' }, { key: 'email', label: 'Principal email', kind: 'email' },
        { key: 'principalName', label: 'Principal name' }, { key: 'registrationNo', label: 'Registration no.', required: false },
      ]}
      submit={(b) => api('POST', '/schools/register', b)}
      onDone={() => { Alert.alert('Submitted', 'You will receive your login by email once the school is verified.'); navigation.goBack(); }}
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
  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: colors.bg }}>
      <Card><Title>{session?.user.name}</Title><Sub>{session?.user.role}</Sub></Card>
      <Button label="Sign out" secondary onPress={logout} />
    </View>
  );
}

const ICON: Record<string, string> = { HOMEWORK: '📚', EVENT: '🎉', FEE: '💰', PICKUP: '🚸', ATTENDANCE: '🗓️', MEDIA: '📷', GENERAL: '📢' };
export function NotificationsScreen() {
  return (
    <ListScreen<any> path="/me/notifications" empty="No notifications yet"
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
  return (
    <ListScreen<any> path="/admin/schools?status=PENDING" empty="No pending schools" header={<Button label="Sign out" secondary onPress={logout} />}
      render={(sc, reload) => (
        <Card>
          <Title>{sc.name}</Title><Sub>{sc.city} · {sc.principalName} · {sc.email}</Sub>
          <Button label="Approve" onPress={async () => {
            try {
              const r = await api('POST', `/admin/schools/${sc.id}/approve`, {});
              Alert.alert('Approved', r.emailSent ? `Login details were emailed to ${r.login}.` : `Email not configured.\nLogin: ${r.login}\nTemp password: ${r.temporaryPassword}`);
              reload();
            } catch (e: any) { Alert.alert('Error', e.message); }
          }} />
          <Button label="Reject" secondary onPress={async () => {
            await api('POST', `/admin/schools/${sc.id}/reject`, { reason: 'Could not verify school details' }).catch((e) => Alert.alert('Error', e.message));
            reload();
          }} />
        </Card>
      )} />
  );
}
