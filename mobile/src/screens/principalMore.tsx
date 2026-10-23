import React from 'react';
import { ActivityIndicator, Image, Modal, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { api, appendUploadFile, authHeaders, BASE, upload } from '../api';
import { popup } from '../ResultPopup';
import { useAuth } from '../auth';
import { ActionRow, Badge, Button, Card, Chip, ErrorState, FormScreen, ListScreen, Loading, ModalPage, Page, ScreenHeader, Sub, Title, colors, day, s, useFetch } from '../ui';
import { NotificationsScreen, ProfileScreen } from './common';
import { FormDef, Stack, batchLabel, batchOpt, classOpt, formScreens } from './shared';

const audienceFields = [
  { key: 'audience', label: 'Send to', kind: 'select' as const, options: [{ value: 'SCHOOL', label: 'Whole school' }, { value: 'CLASS', label: 'One class' }, { value: 'BATCH', label: 'One batch' }] },
  { key: 'classId', label: 'Class', visibleWhen: { key: 'audience', value: 'CLASS' }, ...classOpt },
  { key: 'batchId', label: 'Batch', visibleWhen: { key: 'audience', value: 'BATCH' }, ...batchOpt },
];

const forms: Record<string, FormDef> = {
  AddScheduled: {
    title: 'Schedule notification', post: '/principal/notifications', editPath: '/principal/notifications',
    initialValues: { kind: 'MONTHLY', audience: 'SCHOOL', sendHour: '9' }, submitLabel: 'Save schedule',
    intro: 'Repeats automatically: "Every month" sends on the chosen day of each month; "One time" sends on a date.',
    fields: [
      { key: 'title', label: 'Title', minLength: 2, maxLength: 200 }, { key: 'body', label: 'Message', kind: 'multiline', minLength: 2, maxLength: 5000 },
      { key: 'kind', label: 'Repeat', kind: 'select', options: [{ value: 'MONTHLY', label: 'Every month' }, { value: 'ONCE', label: 'One time' }] },
      { key: 'dayOfMonth', label: 'Day of month', kind: 'number', visibleWhen: { key: 'kind', value: 'MONTHLY' }, min: 1, max: 31, integer: true, help: 'On shorter months, the notification sends on the last day.' },
      { key: 'date', label: 'Send on', kind: 'date', visibleWhen: { key: 'kind', value: 'ONCE' } },
      { key: 'sendHour', label: 'Send at hour (0–23)', kind: 'number', min: 0, max: 23, integer: true, help: 'Uses the school server’s local time. For example, 9 means 9:00 AM.' },
      ...audienceFields,
    ],
  },
  Broadcast: {
    title: 'Send notification now', post: '/principal/broadcast',
    initialValues: { audience: 'SCHOOL' }, submitLabel: 'Send notification',
    fields: [{ key: 'title', label: 'Title' }, { key: 'body', label: 'Message', kind: 'multiline' }, ...audienceFields],
    after: (r) => popup.success('Notification sent!', `Delivered to ${r.recipients} parent(s).`, { emoji: '📣' }),
  },
  AddEvent: {
    title: 'Event', post: '/principal/events', editPath: '/principal/events', intro: 'Parents are notified now and reminded the day before.',
    fields: [
      { key: 'title', label: 'Title' }, { key: 'date', label: 'Date', kind: 'date' },
      { key: 'description', label: 'Description', kind: 'multiline', required: false },
      { key: 'batchId', label: 'Batch (none = whole school)', required: false, emptyValue: null, ...batchOpt },
    ],
  },
};

function Menu({ navigation }: any) {
  const { logout } = useAuth();
  const items: [string, string][] = [
    ['🚸 Pick-up requests', 'Pickups'], ['🔐 Authorized pickup people', 'AuthorizedPeople'], ['📢 Scheduled notifications', 'Scheduled'], ['✉️ Send notification now', 'Broadcast'],
    ['🎉 Events', 'Events'], ['🔔 My alerts', 'Alerts'], ['⚙️ Fee reminder settings', 'Settings'],
  ];
  return (
    <Page>
      <ScreenHeader title="School management" subtitle="Everything you need to keep your school running smoothly." icon="✨" />
      {items.map(([label, screen]) => <Card key={screen} onPress={() => navigation.navigate(screen)}><Title>{label}</Title></Card>)}
      <Card onPress={() => navigation.navigate('Me')}><Title>👤 Profile</Title></Card>
      <Button label="Sign out" secondary onPress={async () => { if (await popup.confirm('Sign out?', 'You can sign back in with your school account.', 'Sign out')) await logout(); }} />
    </Page>
  );
}

const SCHEDULE_AUD: Record<string, string> = { SCHOOL: 'Whole school', CLASS: 'Class', BATCH: 'Batch' };
function Scheduled({ navigation }: any) {
  return (
    <ListScreen<any> path="/principal/notifications" empty="No scheduled notifications"
      searchText={(n) => `${n.title} ${n.body} ${SCHEDULE_AUD[n.audience]}`}
      filters={[{ label: 'Status', value: (n) => n.active ? 'Active' : 'Paused' }, { label: 'Repeats', value: (n) => n.kind === 'MONTHLY' ? 'Monthly' : 'One time' }]}
      countLabel="schedules"
      header={<><ScreenHeader title="Scheduled announcements" subtitle="Create, edit, pause or resume messages for your school community." icon="📢" /><Button label="+ Schedule notification" onPress={() => navigation.navigate('AddScheduled')} /></>}
      render={(n, reload) => (
      <Card>
        <Title>{n.title}</Title><Sub>{n.body}</Sub>
        <Sub>{n.kind === 'MONTHLY' ? `Every month on day ${n.dayOfMonth}` : `Once on ${day(n.date)}`} at {String(n.sendHour).padStart(2, '0')}:00 · {SCHEDULE_AUD[n.audience]}</Sub>
        <Badge text={n.active ? 'ACTIVE' : 'PAUSED'} color={n.active ? colors.ok : colors.muted} />
        <ActionRow>
        <Button label="Edit schedule" secondary onPress={() => navigation.navigate('AddScheduled', { item: n })} />
        <Button label={n.active ? 'Pause schedule' : 'Resume schedule'} secondary onPress={async () => {
          try { await api('PATCH', `/principal/notifications/${n.id}`, { active: !n.active }); popup.success(n.active ? 'Schedule paused' : 'Schedule resumed'); reload(); }
          catch (error: any) { popup.error(error.message); }
        }} />
        </ActionRow>
        <Button label="Delete schedule" secondary danger onPress={async () => {
          if (!(await popup.confirm('Delete this schedule?', 'Future notifications will no longer be sent.', 'Delete', true))) return;
          try { await api('DELETE', `/principal/notifications/${n.id}`); popup.success('Schedule deleted'); reload(); }
          catch (error: any) { popup.error(error.message); }
        }} />
      </Card>
    )} />
  );
}

function Events({ navigation }: any) {
  return (
    <ListScreen<any> path="/principal/events" empty="No events"
      searchText={(event) => `${event.title} ${event.description ?? ''} ${event.batch ? batchLabel(event.batch) : 'Whole school'}`}
      countLabel="events" filters={[{ label: 'Audience', value: (event) => event.batch ? batchLabel(event.batch) : 'Whole school' }]}
      header={<><ScreenHeader title="School calendar" subtitle="Keep families informed about upcoming activities and events." icon="🎉" /><Button label="+ Add event" onPress={() => navigation.navigate('AddEvent')} /></>}
      render={(e, reload) => (
        <Card>
          <Title>{e.title}</Title><Sub>{day(e.date)} · {e.batch ? batchLabel(e.batch) : 'Whole school'}</Sub>
          {e.description ? <Sub>{e.description}</Sub> : null}
          <ActionRow><Button label="Edit event" secondary onPress={() => navigation.navigate('AddEvent', { item: e })} />
          <Button label="Delete event" secondary danger onPress={async () => {
            if (!(await popup.confirm('Delete this event?', 'It will be removed from parent calendars.', 'Delete', true))) return;
            try { await api('DELETE', `/principal/events/${e.id}`); popup.success('Event deleted'); reload(); }
            catch (error: any) { popup.error(error.message); }
          }} /></ActionRow>
        </Card>
      )} />
  );
}

const STATUS_COLOR: Record<string, string> = { PENDING: colors.warn, APPROVED: colors.ok, COMPLETED: colors.ok, REJECTED: colors.bad, CANCELLED: colors.muted };
function Pickups() {
  const [decision, setDecision] = React.useState<{ id: string; approve: boolean; name: string } | null>(null);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [version, setVersion] = React.useState(0);
  const decide = async () => {
    if (!decision || busy) return;
    setBusy(true);
    const { id, approve } = decision;
    try {
      await api('POST', `/principal/pickup-requests/${id}/decide`, { approve, note: note.trim() || undefined });
      setDecision(null); setNote(''); setVersion((previous) => previous + 1);
      if (approve) popup.success('Pick-up Approved!', undefined, { emoji: '🚸' });
      else popup.show({ variant: 'danger', title: 'Pick-up Rejected.', emoji: '🚫' });
    } catch (e: any) { popup.error(e.message); }
    finally { setBusy(false); }
  };
  return (
    <><ListScreen<any> key={version} path="/principal/pickup-requests" empty="No pick-up requests"
      header={<ScreenHeader title="Safe handovers" subtitle="Review each request before approving a trusted adult. Parents receive the decision and verification code." icon="🚸" />}
      countLabel="requests" searchText={(r) => `${r.student.name} ${r.personName} ${r.personPhone} ${r.relation} ${r.reason ?? ''}`}
      filters={[{ label: 'Status', value: (r) => r.status }, { label: 'Type', value: (r) => r.type }, { label: 'Date', value: (r) => day(r.date) }]}
      render={(r) => (
        <Card>
          <Title>{r.student.name} · {r.type}</Title>
          <Sub>{batchLabel(r.student.batch)}</Sub>
          <Sub>{r.personName} ({r.relation}) · {r.personPhone}</Sub>
          <Sub>{day(r.date)}{r.reason ? ` · ${r.reason}` : ''}</Sub>
          <Badge text={r.status} color={STATUS_COLOR[r.status]} />
          {r.decisionNote ? <Sub>Decision note: {r.decisionNote}</Sub> : null}
          {r.status === 'PENDING' ? (
            <ActionRow>
              <Button label="Approve request" onPress={() => { setDecision({ id: r.id, approve: true, name: r.student.name }); setNote(''); }} />
              <Button label="Reject request" secondary danger onPress={() => { setDecision({ id: r.id, approve: false, name: r.student.name }); setNote(''); }} />
            </ActionRow>
          ) : null}
        </Card>
      )} />
      <Modal visible={!!decision} animationType="slide" onRequestClose={() => { if (!busy) setDecision(null); }}>
        <ModalPage>
          <ScreenHeader title={decision?.approve ? 'Approve request' : 'Reject request'} subtitle={`Confirm the handover decision for ${decision?.name ?? ''}. The parent will be notified.`} icon="🚸" />
          <Text style={s.label}>Decision note (optional)</Text>
          <TextInput accessibilityLabel="Decision note" style={[s.input, { minHeight: 120, textAlignVertical: 'top' }]} multiline maxLength={500} value={note} editable={!busy} onChangeText={setNote} placeholder="Add any instructions or a reason for this decision" />
          <Button label={decision?.approve ? 'Confirm approval' : 'Confirm rejection'} danger={!decision?.approve} busy={busy} onPress={decide} />
          <Button label="Cancel" secondary disabled={busy} onPress={() => setDecision(null)} />
        </ModalPage>
      </Modal>
    </>
  );
}

function AuthorizedPeople() {
  const { data: people, err, reload } = useFetch<any[]>('/principal/authorized-pickups', 30000);
  const { data: students, err: studentsError, reload: reloadStudents } = useFetch<any[]>('/principal/students');
  const [editing, setEditing] = React.useState<any | null>(null);
  const [studentId, setStudentId] = React.useState('');
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [relation, setRelation] = React.useState('');
  const [photo, setPhoto] = React.useState<ImagePicker.ImagePickerAsset | null>(null);
  const [aadhaar, setAadhaar] = React.useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [document, setDocument] = React.useState<{ id: string; kind: 'photo' | 'aadhaar' } | null>(null);
  const [documentLoading, setDocumentLoading] = React.useState(false);
  const [documentError, setDocumentError] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [status, setStatus] = React.useState('Active');
  const [studentQuery, setStudentQuery] = React.useState('');

  function reset() {
    setEditing(null); setStudentId(''); setName(''); setPhone(''); setRelation(''); setPhoto(null); setAadhaar(null); setStudentQuery('');
  }
  function openCreate() {
    reset();
    setEditing({});
  }
  function openEdit(person: any) {
    setEditing(person); setStudentId(person.studentId); setName(person.name); setPhone(person.phone); setRelation(person.relation);
    setPhoto(null); setAadhaar(null);
  }
  async function pickDocument(kind: 'photo' | 'aadhaar') {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { popup.warn('Permission needed', 'Allow photo library access to attach the required image.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!result.canceled) {
        const asset = result.assets[0];
        if (asset.mimeType && !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType)) {
          popup.warn('Unsupported file', 'Choose a JPEG, PNG, or WebP image.');
          return;
        }
        if (kind === 'photo') setPhoto(asset);
        else setAadhaar(asset);
      }
    } catch (error: any) { popup.error(error.message, 'Could not open photos'); }
  }
  async function save() {
    if (busy) return;
    if (!studentId || !name.trim() || !phone.trim() || !relation.trim()) {
      popup.warn('Missing information', 'Choose a student and enter the person’s name, phone, and relation.');
      return;
    }
    if ((!editing?.id || !editing.active) && (!photo || !aadhaar)) {
      popup.warn('Documents required', 'A recent photo and Aadhaar card image are required to register or restore access.');
      return;
    }
    if (phone.replace(/\D/g, '').length < 8 || !/^\+?[\d ()-]{8,20}$/.test(phone.trim())) return popup.warn('Invalid phone', 'Enter a valid contact number with at least eight digits.');
    const form = new FormData();
    if (!editing?.id) form.append('studentId', studentId);
    form.append('name', name.trim()); form.append('phone', phone.trim()); form.append('relation', relation.trim());
    if (editing?.id && !editing.active) form.append('active', 'true');
    setBusy(true);
    try {
      if (photo) await appendUploadFile(form, 'photo', photo);
      if (aadhaar) await appendUploadFile(form, 'aadhaar', aadhaar);
      if (editing?.id) await upload(`/principal/authorized-pickups/${editing.id}`, form, 'PATCH');
      else await upload('/principal/authorized-pickups', form);
      popup.success(editing?.id ? 'Authorized person updated' : 'Authorized person added', 'Their sensitive documents are encrypted and access-controlled.', { emoji: '🔐' });
      reset(); await reload();
    } catch (error: any) { popup.error(error.message); }
    finally { setBusy(false); }
  }
  async function deactivate(person: any) {
    if (!(await popup.confirm('Remove authorized access?', `${person.name} will no longer be selectable for new pick-up requests.`, 'Remove', true))) return;
    try { await api('DELETE', `/principal/authorized-pickups/${person.id}`); popup.success('Access removed'); await reload(); }
    catch (error: any) { popup.error(error.message); }
  }

  if (!people || !students) {
    const loadError = err || studentsError;
    return loadError ? <Page><Sub>{loadError}</Sub><Button label="Try again" onPress={() => { reload(); reloadStudents(); }} /></Page> : <Loading />;
  }
  const visible = people.filter((person) => (status === 'All' || person.active === (status === 'Active')) &&
    `${person.name} ${person.student.name} ${person.phone} ${person.relation}`.toLowerCase().includes(query.trim().toLowerCase()));
  const openDocument = (id: string, kind: 'photo' | 'aadhaar') => { setDocumentLoading(true); setDocumentError(''); setDocument({ id, kind }); };
  return (
    <>
      <Page onRefresh={reload}>
        <ScreenHeader title="Trusted pickup people" subtitle={`${people.filter((person) => person.active).length} active people · register and manage trusted adults for each student.`} icon="🔐" />
        <Sub>Aadhaar images are encrypted at rest. Only authorized Principals can open them.</Sub>
        {students.length ? <Button label="+ Register authorized person" onPress={openCreate} /> : <Sub>Enroll a student before registering pickup people.</Sub>}
        <TextInput accessibilityLabel="Search authorized people" style={[s.input, { marginVertical: 12 }]} placeholder="Search person, student, phone or relation" value={query} onChangeText={setQuery} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{['Active', 'Removed', 'All'].map((value) => <Chip key={value} label={value} active={status === value} onPress={() => setStatus(value)} />)}</View>
        <Sub>Showing {visible.length} of {people.length} people</Sub>
        {err ? <ErrorState message={`Could not refresh. ${err}`} onRetry={reload} /> : null}
        {visible.length ? visible.map((person) => (
          <Card key={person.id}>
            <Title>{person.name}</Title>
            <Sub>{person.student.name} · {person.relation} · {person.phone}</Sub>
            <Badge text={person.active ? 'ACTIVE' : 'REMOVED'} color={person.active ? colors.ok : colors.muted} />
            <ActionRow>
              {person.hasPhoto ? <Button label="View photo" secondary onPress={() => openDocument(person.id, 'photo')} /> : null}
              {person.hasAadhaar ? <Button label="View Aadhaar" secondary onPress={() => openDocument(person.id, 'aadhaar')} /> : null}
              <Button label={person.active ? 'Edit details' : 'Restore access'} secondary onPress={() => openEdit(person)} />
              {person.active ? <Button label="Remove access" secondary danger onPress={() => deactivate(person)} /> : null}
            </ActionRow>
          </Card>
        )) : <Sub>{people.length ? 'No people match these filters.' : 'No authorized people registered yet.'}</Sub>}
      </Page>
      <Modal visible={!!editing} animationType="slide" onRequestClose={() => { if (!busy) reset(); }}>
        <ModalPage>
          <Title>{editing?.id ? 'Edit authorized person' : 'Register authorized person'}</Title>
          <Sub>Photo and Aadhaar are required for new registrations and restoring access. Aadhaar numbers are not collected or stored.</Sub>
          {!editing?.id ? (
            <>
              <Title>Student</Title>
              {students.length > 8 ? <TextInput accessibilityLabel="Search students" placeholder="Search student name" style={s.input} value={studentQuery} onChangeText={setStudentQuery} /> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                {students.filter((student) => student.name.toLowerCase().includes(studentQuery.trim().toLowerCase())).map((student) => <Chip key={student.id} label={student.name} active={studentId === student.id} onPress={() => setStudentId(student.id)} />)}
              </View>
            </>
          ) : <Sub>Student: {editing.student?.name}</Sub>}
          <Text style={[s.label, { marginTop: 16 }]}>Full name</Text>
          <TextInput accessibilityLabel="Person’s full name" editable={!busy} style={s.input} placeholder="Person’s full name" value={name} onChangeText={setName} />
          <Text style={[s.label, { marginTop: 16 }]}>Phone number</Text>
          <TextInput accessibilityLabel="Phone number" editable={!busy} style={s.input} placeholder="Phone number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <Text style={[s.label, { marginTop: 16 }]}>Relation to student</Text>
          <TextInput accessibilityLabel="Relation to student" editable={!busy} style={s.input} placeholder="For example: Grandparent" value={relation} onChangeText={setRelation} />
          <Button label={`${photo ? '✓ ' : ''}Choose photo${editing?.id && editing.active ? ' (optional replacement)' : ''}`} secondary disabled={busy} onPress={() => pickDocument('photo')} />
          <Button label={`${aadhaar ? '✓ ' : ''}Choose Aadhaar image${editing?.id && editing.active ? ' (optional replacement)' : ''}`} secondary disabled={busy} onPress={() => pickDocument('aadhaar')} />
          <Button label={editing?.id ? 'Save changes' : 'Register securely'} onPress={save} busy={busy} />
          <Button label="Cancel" secondary disabled={busy} onPress={reset} />
        </ModalPage>
      </Modal>
      <Modal visible={!!document} animationType="fade" onRequestClose={() => setDocument(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#171a18', padding: 16, justifyContent: 'center' }}>
          <Button label="Close document" secondary onPress={() => setDocument(null)} />
          {documentLoading ? <ActivityIndicator color="#fff" accessibilityLabel="Loading private document" /> : null}
          {documentError ? <Text accessibilityRole="alert" style={{ color: '#fff', padding: 16 }}>{documentError}</Text> : null}
          {document ? <Image
            key={`${document.id}-${document.kind}`}
            source={{ uri: `${BASE}/principal/authorized-pickups/${document.id}/documents/${document.kind}`, headers: authHeaders() }}
            onLoadEnd={() => setDocumentLoading(false)}
            onError={() => { setDocumentLoading(false); setDocumentError('The private image could not be loaded. Close this view and try again.'); }}
            resizeMode="contain" style={{ flex: 1, width: '100%' }}
          /> : null}
          <Sub>Private document · close this view when finished.</Sub>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function Settings({ navigation }: any) {
  const { data, err, reload } = useFetch<{ feeReminderDays: number }>('/principal/settings');
  if (!data) return err ? <Page><ErrorState message={err} onRetry={reload} /></Page> : <Loading />;
  return (
    <FormScreen
      intro={`Fee reminders are sent automatically every morning. Currently: ${data.feeReminderDays} day(s) before the due date, then every 3 days until paid.`}
      initialValues={{ feeReminderDays: String(data.feeReminderDays) }}
      topContent={err ? <ErrorState message={`Could not refresh the saved settings. ${err}`} onRetry={reload} /> : undefined}
      fields={[{ key: 'feeReminderDays', label: 'Start reminders (days before due date)', kind: 'number', min: 0, max: 30, integer: true, help: 'Choose 0–30 days. Zero starts reminders on the due date.' }]}
      submit={(b) => api('PATCH', '/principal/settings', b)}
      onDone={() => { popup.success('Saved!'); navigation.goBack(); }} />
  );
}

export function MoreStack() {
  return (
    <Stack.Navigator screenOptions={{ animation: 'slide_from_right' }}>
      <Stack.Screen name="Menu" component={Menu} options={{ title: 'More' }} />
      <Stack.Screen name="Pickups" component={Pickups} options={{ title: 'Pick-up requests' }} />
      <Stack.Screen name="AuthorizedPeople" component={AuthorizedPeople} options={{ title: 'Authorized people' }} />
      <Stack.Screen name="Scheduled" component={Scheduled} options={{ title: 'Scheduled notifications' }} />
      <Stack.Screen name="Events" component={Events} />
      <Stack.Screen name="Alerts" component={NotificationsScreen} options={{ title: 'My alerts' }} />
      <Stack.Screen name="Settings" component={Settings} options={{ title: 'Fee reminders' }} />
      <Stack.Screen name="Me" component={ProfileScreen} options={{ title: 'Profile' }} />
      {formScreens(forms)}
    </Stack.Navigator>
  );
}
