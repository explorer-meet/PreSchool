import React, { useMemo, useState } from 'react';
import { Image, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { api, appendUploadFile, authHeaders, BASE, upload } from '../api';
import { popup } from '../ResultPopup';
import { Badge, Button, Card, Chip, FormScreen, Heading, ListScreen, Page, Sub, Title, colors, day, s, useFetch } from '../ui';
import { MediaGrid } from './media';
import { NotificationsScreen, ProfileScreen } from './common';
import { Stack } from './shared';

const Tabs = createBottomTabNavigator();

function MyBatches({ navigation }: any) {
  return (
    <ListScreen<any> path="/teacher/batches" empty="No class has been assigned to you yet"
      render={(b) => (
        <Card onPress={() => navigation.navigate('BatchHome', { batch: b })}>
          <Title>{b.class.name} – {b.name}</Title>
          <Sub>{b.startTime ?? '--'} – {b.endTime ?? '--'} · {b._count.students} students</Sub>
        </Card>
      )} />
  );
}

function BatchHome({ navigation, route }: any) {
  const { batch } = route.params;
  const go = (screen: string, label: string) => <Card key={screen} onPress={() => navigation.navigate(screen, { batch })}><Title>{label}</Title></Card>;
  return (
    <Page>
      {go('Attendance', '🗓️ Mark attendance')}
      {go('Work', '📚 Classwork & homework')}
      {go('Media', '📷 Photos & videos')}
      {go('Students', '👧 Students, reports & medical')}
    </Page>
  );
}

type Status = 'PRESENT' | 'ABSENT' | 'LATE';
function Attendance({ route }: any) {
  const { batch } = route.params;
  const { data, reload } = useFetch<any[]>(`/teacher/batches/${batch.id}/attendance`);
  const [edits, setEdits] = useState<Record<string, { status?: Status | null; late?: string }>>({});
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => Object.fromEntries((data ?? []).map((d) => [
    d.id, { status: edits[d.id]?.status ?? d.status, late: edits[d.id]?.late ?? (d.lateMinutes ? String(d.lateMinutes) : '') },
  ])) as Record<string, { status: Status | null; late: string }>, [data, edits]);
  if (!data) return null;
  const set = (id: string, p: Partial<{ status: Status | null; late: string }>) => setEdits((r) => ({ ...r, [id]: { ...r[id], ...p } }));

  async function save() {
    const records: any[] = [];
    for (const st of data!) {
      const r = rows[st.id];
      if (!r?.status) continue;
      if (r.status === 'LATE') {
        const m = parseInt(r.late, 10);
        if (!m || m < 1) return popup.warn('Late minutes', `Enter how many minutes ${st.name} was late`);
        records.push({ studentId: st.id, status: 'LATE', lateMinutes: m });
      } else records.push({ studentId: st.id, status: r.status });
    }
    if (!records.length) return popup.warn('Nothing to save', 'Mark at least one child');
    setBusy(true);
    try {
      await api('POST', `/teacher/batches/${batch.id}/attendance`, { date: new Date().toISOString().slice(0, 10), records });
      popup.success('Attendance saved!', 'Parents of absent/late children were notified.', { emoji: '🗓️' });
      setEdits({});
      await reload();
    } catch (e: any) { popup.error(e.message); } finally { setBusy(false); }
  }

  const mark: [Status, string, string][] = [['PRESENT', 'Present', colors.ok], ['ABSENT', 'Absent', colors.bad], ['LATE', 'Late', colors.warn]];
  return (
    <Page>
      <Sub>{day(new Date())}</Sub>
      <Button label="Mark everyone present" secondary onPress={() => setEdits(Object.fromEntries(data.map((d) => [d.id, { status: 'PRESENT' as Status, late: '' }])))} />
      {data.map((st) => {
        const r = rows[st.id] ?? { status: null, late: '' };
        return (
          <Card key={st.id}>
            <Title>{st.name}</Title>
            <View style={{ flexDirection: 'row', marginTop: 8 }}>
              {mark.map(([v, label]) => <Chip key={v} label={label} active={r.status === v} onPress={() => set(st.id, { status: v })} />)}
            </View>
            {r.status === 'LATE' ? (
              <TextInput style={s.input} keyboardType="number-pad" placeholder="Minutes late" value={r.late} onChangeText={(t) => set(st.id, { late: t.replace(/\D/g, '') })} />
            ) : null}
          </Card>
        );
      })}
      <Button label="Save attendance" onPress={save} busy={busy} />
    </Page>
  );
}

function Work({ navigation, route }: any) {
  const { batch } = route.params;
  return (
    <ListScreen<any> path={`/teacher/batches/${batch.id}/homework`} empty="Nothing posted yet"
      header={<Button label="+ Add classwork / homework" onPress={() => navigation.navigate('AddWork', { batch })} />}
      render={(h) => (
        <Card>
          <Title>{h.title}</Title><Sub>{h.description}</Sub>
          <Sub>{day(h.createdAt)}{h.dueDate ? ` · due ${day(h.dueDate)}` : ''}</Sub>
          <Badge text={h.kind} color={h.kind === 'HOMEWORK' ? colors.primary : colors.ok} />
        </Card>
      )} />
  );
}

const AddWork = ({ navigation, route }: any) => (
  <FormScreen submitLabel="Post & notify parents"
    fields={[
      { key: 'kind', label: 'Type', kind: 'select', options: [{ value: 'CLASSWORK', label: 'Classwork (done in class)' }, { value: 'HOMEWORK', label: 'Homework' }] },
      { key: 'title', label: 'Title' }, { key: 'description', label: 'Description', kind: 'multiline' },
      { key: 'dueDate', label: 'Due date', kind: 'date', required: false },
    ]}
    submit={(b) => api('POST', `/teacher/batches/${route.params.batch.id}/homework`, b)}
    onDone={() => { popup.success('Notification sent!', 'Parents have been notified.', { emoji: '📣' }); navigation.goBack(); }} />
);

function Media({ navigation, route }: any) {
  const { batch } = route.params;
  const { data, err } = useFetch<any[]>(`/teacher/batches/${batch.id}/media`);
  return (
    <Page>
      <Button label="📷 Add photo / video" onPress={() => navigation.navigate('AddMedia', { batch })} />
      {err ? <Text style={s.err}>{err}</Text> : null}
      {data ? <MediaGrid items={data} tagsOf={(m) => (m.tags.length ? m.tags.map((t: any) => t.student.name).join(', ') : 'Whole class')} /> : null}
    </Page>
  );
}

function AddMedia({ navigation, route }: any) {
  const { batch } = route.params;
  const { data: students } = useFetch<any[]>(`/teacher/batches/${batch.id}/students`);
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [tagged, setTagged] = useState<string[]>([]);
  const [wholeClass, setWholeClass] = useState(true);
  const [activity, setActivity] = useState(''); const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);

  async function pick(source: 'camera' | 'library') {
    const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return popup.warn('Permission needed', 'Please allow access in settings.');
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images', 'videos'], quality: 0.7, videoMaxDuration: 60 };
    const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!r.canceled) setAsset(r.assets[0]);
  }

  async function send() {
    if (!asset) return popup.warn('Choose a photo or video first');
    if (!wholeClass && !tagged.length) return popup.warn('Select who to share with', 'Pick at least one child, or share with the whole class.');
    const form = new FormData();
    if (activity.trim()) form.append('activity', activity.trim());
    if (caption.trim()) form.append('caption', caption.trim());
    if (!wholeClass) form.append('studentIds', JSON.stringify(tagged));
    setBusy(true);
    try {
      await appendUploadFile(form, 'file', asset, false);
      await upload(`/teacher/batches/${batch.id}/media`, form);
      popup.success('Shared!', wholeClass ? 'Published to all parents of this batch.' : 'Shared with the selected children’s parents.', { emoji: '📷' });
      navigation.goBack();
    } catch (e: any) { popup.error(e.message, 'Upload failed'); } finally { setBusy(false); }
  }

  return (
    <Page>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1 }}><Button label="Camera" onPress={() => pick('camera')} /></View>
        <View style={{ width: 8 }} />
        <View style={{ flex: 1 }}><Button label="Gallery" secondary onPress={() => pick('library')} /></View>
      </View>
      {asset ? <Badge text={`${asset.type === 'video' ? 'Video' : 'Photo'} selected`} color={colors.ok} /> : null}
      <Heading>Share with</Heading>
      <View style={{ flexDirection: 'row' }}>
        <Chip label="Whole class" active={wholeClass} onPress={() => setWholeClass(true)} />
        <Chip label="Specific children" active={!wholeClass} onPress={() => setWholeClass(false)} />
      </View>
      {!wholeClass ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {(students ?? []).map((st) => (
            <Chip key={st.id} label={st.name} active={tagged.includes(st.id)} onPress={() => setTagged((t) => (t.includes(st.id) ? t.filter((x) => x !== st.id) : [...t, st.id]))} />
          ))}
        </View>
      ) : null}
      <Text style={[s.label, { marginTop: 8 }]}>Activity (optional)</Text>
      <TextInput style={s.input} value={activity} onChangeText={setActivity} placeholder="Painting, Sports day..." />
      <Text style={[s.label, { marginTop: 8 }]}>Caption (optional)</Text>
      <TextInput style={s.input} value={caption} onChangeText={setCaption} />
      <Button label="Share with parents" onPress={send} busy={busy} />
    </Page>
  );
}

function Students({ navigation, route }: any) {
  const { batch } = route.params;
  return (
    <ListScreen<any> path={`/teacher/batches/${batch.id}/students`} empty="No students in this batch"
      render={(st) => (
        <Card onPress={() => navigation.navigate('Student', { student: st })}>
          <Title>{st.name}</Title>
          <Sub>Parent: {st.parent.name} ({st.parent.phone})</Sub>
          {st.allergies ? <Badge text={`Allergies: ${st.allergies}`} color={colors.bad} /> : null}
        </Card>
      )} />
  );
}

function Student({ navigation, route }: any) {
  const { student } = route.params;
  return (
    <ListScreen<any> path={`/teacher/students/${student.id}/medical`} empty="No medical history recorded"
      header={<>
        <Heading>{student.name}</Heading>
        <Sub>Blood group: {student.bloodGroup ?? '-'} · Allergies: {student.allergies ?? 'none'}</Sub>
        <Button label="Add progress report" onPress={() => navigation.navigate('Report', { student })} />
        <Button label="Add medical record" secondary onPress={() => navigation.navigate('Medical', { student })} />
        <Heading>Medical history</Heading>
      </>}
      render={(m) => <Card><Title>{m.title}</Title><Sub>{m.type} · {day(m.date)}{m.notes ? ` · ${m.notes}` : ''}</Sub></Card>} />
  );
}

const Report = ({ navigation, route }: any) => (
  <FormScreen
    intro="Rate each skill from 1 (needs support) to 5 (excellent). Parents see this in the child's performance."
    fields={[
      { key: 'term', label: 'Term / period', placeholder: 'Term 1 2026' },
      ...(['language', 'numeracy', 'social', 'motor', 'creativity'] as const).map((k) => ({ key: k, label: `${k[0].toUpperCase()}${k.slice(1)} (1-5)`, kind: 'number' as const, required: false })),
      { key: 'remarks', label: 'Remarks', kind: 'multiline', required: false },
    ]}
    submit={(b) => api('POST', `/teacher/students/${route.params.student.id}/reports`, b)}
    onDone={() => navigation.goBack()} />
);

const Medical = ({ navigation, route }: any) => (
  <FormScreen
    fields={[
      { key: 'type', label: 'Type', kind: 'select', options: ['CHECKUP', 'VACCINATION', 'ILLNESS', 'ALLERGY', 'OTHER'].map((v) => ({ value: v, label: v })) },
      { key: 'title', label: 'Title' }, { key: 'date', label: 'Date', kind: 'date' }, { key: 'notes', label: 'Notes', kind: 'multiline', required: false },
    ]}
    submit={(b) => api('POST', `/teacher/students/${route.params.student.id}/medical`, b)}
    onDone={() => navigation.goBack()} />
);

const ClassesStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="MyBatches" component={MyBatches} options={{ title: 'My classes' }} />
    <Stack.Screen name="BatchHome" component={BatchHome} options={({ route }: any) => ({ title: `${route.params.batch.class.name} – ${route.params.batch.name}` })} />
    <Stack.Screen name="Attendance" component={Attendance} options={{ title: 'Attendance' }} />
    <Stack.Screen name="Work" component={Work} options={{ title: 'Classwork & homework' }} />
    <Stack.Screen name="AddWork" component={AddWork} options={{ title: 'Add' }} />
    <Stack.Screen name="Media" component={Media} options={{ title: 'Photos & videos' }} />
    <Stack.Screen name="AddMedia" component={AddMedia} options={{ title: 'Share photo / video' }} />
    <Stack.Screen name="Students" component={Students} />
    <Stack.Screen name="Student" component={Student} options={{ title: 'Student' }} />
    <Stack.Screen name="Report" component={Report} options={{ title: 'Progress report' }} />
    <Stack.Screen name="Medical" component={Medical} options={{ title: 'Medical record' }} />
  </Stack.Navigator>
);

function PickupCard({ p, reload }: { p: any; reload: () => void }) {
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <Card>
      <Title>{p.student.name} — {p.type}</Title>
      <Sub>{p.personName} ({p.relation}) · {p.personPhone}</Sub>
      {p.authorizedPersonId ? (
        <>
          <Sub>Registered pickup person · verify their identity before handover</Sub>
          <Image source={{ uri: `${BASE}/teacher/pickups/${p.id}/authorized-photo`, headers: authHeaders() }}
            resizeMode="cover" style={{ width: 112, height: 112, borderRadius: 16, marginVertical: 10 }} />
        </>
      ) : null}
      <Text style={[s.label, { marginTop: 8 }]}>Ask the person for their 4-digit code</Text>
      <TextInput style={s.input} keyboardType="number-pad" maxLength={4} value={code} onChangeText={setCode} placeholder="----" />
      <Button label="Verify & hand over" busy={busy} onPress={async () => {
        setBusy(true);
        try { await api('POST', `/teacher/pickups/${p.id}/complete`, { code }); popup.success('Pick-up verified', 'Handed over safely.', { emoji: '🚸' }); reload(); } catch (e: any) { popup.error(e.message, 'Not verified'); } finally { setBusy(false); }
      }} />
    </Card>
  );
}
const Pickups = () => <ListScreen<any> path="/teacher/pickups" empty="No approved pick-ups for today" render={(p, reload) => <PickupCard p={p} reload={reload} />} />;

const PickupStack = () => <Stack.Navigator><Stack.Screen name="PickupsToday" component={Pickups} options={{ title: 'Pick-ups today' }} /></Stack.Navigator>;
const icons: Record<string, string> = { Classes: '🏫', 'Pick-ups': '🚸', Alerts: '🔔', Me: '👤' };

export function TeacherApp() {
  return (
    <Tabs.Navigator screenOptions={({ route }) => ({
      tabBarActiveTintColor: colors.primary,
      tabBarIcon: () => <Title>{icons[route.name]}</Title>,
      tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, paddingTop: 5, elevation: 8 },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
    })}>
      <Tabs.Screen name="Classes" component={ClassesStack} options={{ headerShown: false }} />
      <Tabs.Screen name="Pick-ups" component={PickupStack} options={{ headerShown: false }} />
      <Tabs.Screen name="Alerts" component={NotificationsScreen} />
      <Tabs.Screen name="Me" component={ProfileScreen} />
    </Tabs.Navigator>
  );
}
