import React, { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { api, appendUploadFile, authHeaders, BASE, upload } from '../api';
import { RegistrationResult, RegistrationSuccess } from '../RegistrationSuccess';
import { popup } from '../ResultPopup';
import { useAuth } from '../auth';
import { ActionRow, Badge, Button, Card, Chip, ErrorState, FormScreen, Heading, ListScreen, Loading, ModalPage, Page, ScreenHeader, Segmented, Sub, Title, colors, day, isoToday, money, useFetch } from '../ui';
import { MoreStack } from './principalMore';
import { FormDef, Stack, batchLabel, batchOpt, classOpt, credsAlert, formScreens } from './shared';

// ---------- Home ----------
function Dashboard({ navigation }: any) {
  const { data, err, reload, updatedAt } = useFetch<any>('/principal/dashboard', 30000);
  const { session } = useAuth();
  if (!data && !err) return <Loading />;
  if (!data) return <Page><Heading>Dashboard</Heading><Sub>{err}</Sub><Button label="Try again" onPress={reload} /></Page>;
  const a = data.attendanceToday ?? {};
  const present = (a.PRESENT ?? 0) + (a.LATE ?? 0);
  const attendancePercent = data.students ? Math.min(100, Math.round((present / data.students) * 100)) : 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const quickActions: [string, string, string, string][] = [
    ['👩‍🏫', 'Add teacher', 'Invite a staff member', 'AddStaff'],
    ['🧒', 'Add student', 'Start an enrolment', 'AddStudent'],
    ['🏫', 'Classes', 'Manage classes & batches', 'ClassesHome'],
    ['🚸', 'Pick-ups', 'Review family requests', 'Pickups'],
  ];
  return (
    <Page onRefresh={reload}>
      {err ? <ErrorState message={`Could not refresh. Showing the last saved dashboard. ${err}`} onRetry={reload} /> : null}
      <View style={styles.welcome}>
        <View style={styles.principalPill}><Text style={styles.principalPillText}>PRINCIPAL</Text><Text style={styles.welcomeHint}> Running the school, one day at a time</Text></View>
        <Text style={styles.greeting}>{greeting}, {session?.user.name.split(' ')[0] ?? 'Principal'} 👋</Text>
        <Text style={styles.welcomeHint}>{data.schoolName} · {day(new Date())}</Text>
      </View>
      {updatedAt ? <Sub>Updated {updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · pull to refresh</Sub> : null}

      <View style={styles.attendanceCard}>
        <View style={styles.attendanceHeader}><Text style={styles.attendanceLabel}>TODAY&apos;S ATTENDANCE</Text><Text style={styles.attendancePercent}>{attendancePercent}%</Text></View>
        <Text style={styles.attendanceCount}>{present}<Text style={styles.attendanceTotal}> / {data.students} present</Text></Text>
        <View style={styles.progressTrack}><View style={[styles.progressBar, { width: `${attendancePercent}%` }]} /></View>
        {/* <View style={styles.attendanceLegend}>
          <Text style={styles.attendanceLegendText}>✅ {a.PRESENT ?? 0} present</Text>
          <Text style={styles.attendanceLegendText}>🕒 {a.LATE ?? 0} late</Text>
          <Text style={styles.attendanceLegendText}>❌ {a.ABSENT ?? 0} absent</Text>
        </View> */}
      </View>

      <Heading>School at a glance</Heading>
      <View style={styles.statsRow}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${data.students} students. View students`} style={styles.statCard} onPress={() => navigation.navigate('People', { screen: 'PeopleHome', params: { peopleTab: 'Students' } })}><Text style={styles.statEmoji}>🧒</Text><Text style={styles.statNumber}>{data.students}</Text><Text style={styles.statLabel}>Students</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${data.batches} batches. Manage batches`} style={styles.statCard} onPress={() => navigation.navigate('Classes', { screen: 'ClassesHome', params: { classTab: 'Batches' } })}><Text style={styles.statEmoji}>🏫</Text><Text style={styles.statNumber}>{data.batches}</Text><Text style={styles.statLabel}>Batches</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${data.staff} staff. View teachers and staff`} style={styles.statCard} onPress={() => navigation.navigate('People', { screen: 'PeopleHome', params: { peopleTab: 'Teachers & staff' } })}><Text style={styles.statEmoji}>👩‍🏫</Text><Text style={styles.statNumber}>{data.staff}</Text><Text style={styles.statLabel}>Staff</Text></TouchableOpacity>
      </View>

      <Heading>Quick actions</Heading>
      <View style={styles.actionGrid}>
        {quickActions.map(([emoji, title, hint, screen]) => (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={title} key={screen} activeOpacity={0.78} style={styles.actionCard} onPress={() => {
            if (screen === 'Pickups') navigation.navigate('More', { screen });
            else if (screen === 'ClassesHome') navigation.navigate('Classes', { screen });
            else navigation.navigate('People', { screen, initial: false });
          }}>
            <Text style={styles.actionEmoji}>{emoji}</Text><Text style={styles.actionTitle}>{title}</Text><Text style={styles.actionHint}>{hint}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Heading>This week</Heading>
      <Card><View style={styles.weekRow}><Text style={styles.weekIcon}>📚</Text><View style={{ flex: 1 }}><Title>{data.updatesThisWeek ?? 0} class updates</Title><Sub>Photos, learning activities and school events</Sub></View></View></Card>
      <Card onPress={() => navigation.navigate('More', { screen: 'Pickups' })}>
        <View style={styles.weekRow}><Text style={styles.weekIcon}>🚸</Text><View style={{ flex: 1 }}><Title>Pick-up requests</Title><Sub>{data.pendingPickups ? `${data.pendingPickups} waiting for your approval` : 'No pending requests'}</Sub></View></View>
        {data.pendingPickups ? <Badge text="ACTION NEEDED" color={colors.warn} /> : null}
      </Card>
      <Card onPress={() => navigation.navigate('Fees')}>
        <View style={styles.weekRow}><Text style={styles.weekIcon}>💰</Text><View style={{ flex: 1 }}><Title>{money(data.feesOutstanding)} outstanding</Title><Sub>{money(data.feesOverdue)} overdue · tap to view fees</Sub></View></View>
      </Card>
    </Page>
  );
}
const HomeStack = () => (
  <Stack.Navigator screenOptions={{ animation: 'slide_from_right' }}><Stack.Screen name="Dashboard" component={Dashboard} options={{ title: 'Principal dashboard' }} /></Stack.Navigator>
);

// ---------- Classes, batches, fee plans ----------
const FREQ = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME'].map((v) => ({ value: v, label: v }));
const classForms: Record<string, FormDef> = {
  AddClass: {
    title: 'Class', post: '/principal/classes', editPath: '/principal/classes',
    fields: [{ key: 'name', label: 'Class name', placeholder: 'Jr KG', minLength: 2, maxLength: 60 }],
  },
  AddBatch: {
    title: 'Batch', post: '/principal/batches', editPath: '/principal/batches',
    fields: [
      { key: 'classId', label: 'Class', ...classOpt },
      { key: 'name', label: 'Shift', kind: 'select', options: ['Morning', 'Noon', 'Afternoon'].map((v) => ({ value: v, label: v })) },
      { key: 'startTime', label: 'Start time', kind: 'time', required: false, emptyValue: null }, { key: 'endTime', label: 'End time', kind: 'time', required: false, emptyValue: null },
      { key: 'academicYear', label: 'Academic year', placeholder: '2026-27' },
      { key: 'capacity', label: 'Capacity', kind: 'number', required: false, min: 1, integer: true },
      { key: 'teacherId', label: 'Class teacher', kind: 'select', optionsPath: '/principal/staff', optionFilter: (u) => u.role === 'TEACHER' && u.active, optionLabel: (u) => u.name, required: false, emptyValue: null },
    ],
  },
  AddFee: {
    title: 'Fee plan', post: '/principal/fee-structures', editPath: '/principal/fee-structures',
    editFields: [
      { key: 'name', label: 'Fee name', minLength: 2 }, { key: 'amount', label: 'Amount (₹)', kind: 'money', min: 0.01 },
      { key: 'frequency', label: 'Frequency', kind: 'select', options: FREQ },
      { key: 'dueDay', label: 'Due day of month (1-28)', kind: 'number', required: false, min: 1, max: 28, integer: true },
    ],
    fields: [
      { key: 'classId', label: 'Class', ...classOpt }, { key: 'name', label: 'Fee name', placeholder: 'Tuition' },
      { key: 'amount', label: 'Amount (₹)', kind: 'money', min: 0.01 }, { key: 'frequency', label: 'Frequency', kind: 'select', options: FREQ },
      { key: 'dueDay', label: 'Due day of month (1-28)', kind: 'number', required: false, min: 1, max: 28, integer: true },
    ],
  },
};

function ClassesHome({ navigation, route }: any) {
  const tab = route.params?.classTab ?? 'Classes';
  const setTab = (classTab: string) => navigation.setParams({ classTab });
  const add = (label: string, screen: string) => <Button label={label} onPress={() => navigation.navigate(screen)} />;
  return (
    <>
      <Segmented tabs={[{ value: 'Classes', label: 'Class', icon: '🏫' }, { value: 'Batches', label: 'Batch', icon: '📚' }, { value: 'Fee plans', label: 'Fee', icon: '💰' }]} value={tab} onChange={setTab} />
      {tab === 'Classes' && (
        <ListScreen<any> key="c" path="/principal/classes" header={add('+ Add class (Jr KG, Sr KG...)', 'AddClass')}
          countLabel="classes" searchText={(item) => item.name}
          render={(c, reload) => (
            <Card>
              <Title>{c.name}</Title><Sub>{c._count.batches} batches · {c.feeStructures.length} fee items</Sub>
              <ActionRow><Button label="Edit class" secondary onPress={() => navigation.navigate('AddClass', { item: c })} />
              <Button label="Delete class" secondary danger onPress={async () => {
                if (!(await popup.confirm('Delete this class?', 'Classes with batches or fees cannot be deleted.', 'Delete', true))) return;
                try { await api('DELETE', `/principal/classes/${c.id}`); popup.success('Class deleted'); reload(); } catch (e: any) { popup.error(e.message); }
              }} /></ActionRow>
            </Card>
          )} />
      )}
      {tab === 'Batches' && (
        <ListScreen<any> key="b" path="/principal/batches" header={add('+ Add batch (Morning / Noon)', 'AddBatch')}
          countLabel="batches" searchText={(item) => `${batchLabel(item)} ${item.academicYear} ${item.teacher?.name ?? ''}`}
          filters={[{ label: 'Class', value: (item) => item.class.name }]}
          render={(b, reload) => (
            <Card>
              <Title>{batchLabel(b)}</Title>
              <Sub>{b.startTime ?? '--'} – {b.endTime ?? '--'} · {b.academicYear}</Sub>
              <Sub>Teacher: {b.teacher?.name ?? 'unassigned'} · {b._count.students}{b.capacity ? `/${b.capacity}` : ''} students</Sub>
              <ActionRow><Button label="Edit batch" secondary onPress={() => navigation.navigate('AddBatch', { item: b })} />
              {b.teacher ? <Button label="Unassign teacher" secondary onPress={async () => {
                try { await api('PATCH', `/principal/batches/${b.id}`, { teacherId: null }); popup.success('Teacher unassigned'); reload(); } catch (e: any) { popup.error(e.message); }
              }} /> : null}
              <Button label="Delete batch" secondary danger onPress={async () => {
                if (!(await popup.confirm('Delete this batch?', 'Batches with enrolled students cannot be deleted.', 'Delete', true))) return;
                try { await api('DELETE', `/principal/batches/${b.id}`); popup.success('Batch deleted'); reload(); } catch (e: any) { popup.error(e.message); }
              }} /></ActionRow>
            </Card>
          )} />
      )}
      {tab === 'Fee plans' && (
        <ListScreen<any> key="f" path="/principal/fee-structures" header={add('+ Add fee', 'AddFee')}
          countLabel="fee plans" searchText={(item) => `${item.name} ${item.class.name} ${item.frequency}`}
          filters={[{ label: 'Class', value: (item) => item.class.name }]}
          render={(f, reload) => (
            <Card>
              <Title>{f.class.name} · {f.name}</Title><Sub>{money(f.amount)} {f.frequency} · due on day {f.dueDay}</Sub>
              <ActionRow><Button label="Edit fee plan" secondary onPress={() => navigation.navigate('AddFee', { item: f })} />
              <Button label="Delete fee plan" secondary danger onPress={async () => {
                if (!(await popup.confirm('Delete this fee plan?', 'Existing invoices must be retained; plans with invoices cannot be deleted.', 'Delete', true))) return;
                try { await api('DELETE', `/principal/fee-structures/${f.id}`); popup.success('Fee plan deleted'); reload(); } catch (e: any) { popup.error(e.message); }
              }} /></ActionRow>
            </Card>
          )} />
      )}
    </>
  );
}
const ClassesStack = () => (
  <Stack.Navigator screenOptions={{ animation: 'slide_from_right' }}>
    <Stack.Screen name="ClassesHome" component={ClassesHome} options={{ title: 'Classes & fees' }} />
    {formScreens(classForms)}
  </Stack.Navigator>
);

// ---------- People ----------
const peopleForms: Record<string, FormDef> = {
  EditStudent: {
    title: 'Edit student', post: '/principal/students', editPath: '/principal/students',
    fields: [
      { key: 'name', label: 'Student name' }, { key: 'dob', label: 'Date of birth', kind: 'date' },
      { key: 'batchId', label: 'Class and batch', ...batchOpt },
      { key: 'gender', label: 'Gender', required: false },
      { key: 'bloodGroup', label: 'Blood group', required: false },
      { key: 'allergies', label: 'Allergies', kind: 'multiline', required: false },
      { key: 'homeAddress', label: 'Home address', kind: 'multiline', required: false },
      { key: 'alternateParentPhone', label: 'Alternate parent phone', kind: 'phone', required: false },
      { key: 'transportMode', label: 'Transport', kind: 'select', required: false, options: [{ value: 'SCHOOL_VAN', label: 'School van' }, { value: 'PERSONAL', label: 'Personal' }] },
      { key: 'transportContact', label: 'Transport / emergency contact', kind: 'phone', required: false },
      { key: 'photoConsent', label: 'Photo sharing consent', kind: 'select', options: [{ value: 'true', label: 'Consented' }, { value: 'false', label: 'Not consented' }] },
    ],
    transform: (body) => ({ ...body, photoConsent: body.photoConsent === 'true' }),
  },
};

const staffCreateFields = [
  { key: 'name', label: 'Name' },
  { key: 'role', label: 'Role', kind: 'select' as const, options: ['TEACHER', 'HELPER', 'STAFF'].map((v) => ({ value: v, label: v })) },
  { key: 'email', label: 'Email', kind: 'email' as const }, { key: 'phone', label: 'Phone', kind: 'phone' as const },
  { key: 'address', label: 'Address', required: false }, { key: 'designation', label: 'Designation', required: false },
  { key: 'batchId', label: 'Assigned class & batch', required: false, ...batchOpt },
  { key: 'salary', label: 'Monthly salary (₹)', kind: 'number' as const, required: false },
];
const staffEditFields = [
  { key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone', kind: 'phone' as const },
  { key: 'address', label: 'Address', required: false }, { key: 'designation', label: 'Designation', required: false },
  { key: 'salary', label: 'Monthly salary (₹)', kind: 'number' as const, required: false },
];

function StaffForm({ navigation, route }: any) {
  const item = route.params?.item;
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  async function pickPhoto() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return popup.warn('Permission needed', 'Allow photo library access to attach a staff photo.');
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!result.canceled) {
        const asset = result.assets[0];
        if (asset.mimeType && !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType)) {
          popup.warn('Unsupported file', 'Choose a JPEG, PNG, or WebP image.');
          return;
        }
        setPhoto(asset);
      }
    } catch (error: any) { popup.error(error.message, 'Could not open photos'); }
  }
  const fields = item ? staffEditFields : staffCreateFields;
  const initialValues = item ? Object.fromEntries(staffEditFields.map((field) => [field.key, item[field.key] == null ? '' : String(item[field.key])])) : { role: 'TEACHER' };
  if (result) return <RegistrationSuccess result={result} kind="staff" onDone={() => navigation.popTo('PeopleHome', { peopleTab: 'Teachers & staff' })} onAnother={() => { setResult(null); setPhoto(null); setFormKey((key) => key + 1); }} />;
  return (
    <FormScreen
      key={item?.id ?? formKey}
      submitLabel={item ? 'Save staff changes' : 'Register and invite staff'}
      intro={item ? 'Update the staff profile. Email and role are managed separately.' : 'Login details are emailed to the staff member. Photo upload is optional.'}
      fields={fields}
      initialValues={initialValues}
      topContent={<>
        <Button label={photo ? 'Change photo' : item?.hasPhoto ? 'Replace staff photo' : 'Choose staff photo (optional)'} secondary onPress={pickPhoto} />
        {photo ? <Image source={{ uri: photo.uri }} style={{ width: 92, height: 92, borderRadius: 46, alignSelf: 'center', marginBottom: 12 }} /> :
          item?.hasPhoto ? <Image source={{ uri: `${BASE}/principal/staff/${item.id}/photo`, headers: authHeaders() }}
            style={{ width: 92, height: 92, borderRadius: 46, alignSelf: 'center', marginBottom: 12 }} /> : null}
      </>}
      submit={async (body: any) => {
        const form = new FormData();
        Object.entries(body).forEach(([key, value]) => { if (value != null) form.append(key, String(value)); });
        if (photo) await appendUploadFile(form, 'photo', photo);
        return upload(`/principal/staff${item ? `/${item.id}` : ''}`, form, item ? 'PATCH' : 'POST');
      }}
      onDone={(result: any) => {
        if (item) popup.success('Staff profile updated');
        if (item) navigation.goBack();
        else setResult({ name: result.name, detail: result.role, login: result.login, emailSent: result.emailSent, temporaryPassword: result.temporaryPassword });
      }} />
  );
}

function WizardInput({ label, value, onChange, placeholder, keyboardType = 'default', multiline = false }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad'; multiline?: boolean;
}) {
  return (
    <View style={styles.wizardField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value} onChangeText={onChange} placeholder={placeholder} keyboardType={keyboardType}
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
        multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.fieldInput, multiline && styles.multilineInput]}
      />
    </View>
  );
}

function StudentWizard({ navigation }: any) {
  const { data: batches, err: batchesError, reload: reloadBatches } = useFetch<any[]>('/principal/batches');
  const [step, setStep] = useState(1);
  const [values, setValues] = useState<Record<string, string>>({ transportMode: 'SCHOOL_VAN', photoConsent: 'false' });
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [document, setDocument] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const set = (key: string, value: string) => setValues((old) => ({ ...old, [key]: value }));

  async function pickDocument() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return popup.warn('Permission needed', 'Allow photo library access to attach an identity document.');
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!result.canceled) setDocument(result.assets[0]);
    } catch (e: any) { popup.error(e.message, 'Could not open photos'); }
  }
  async function pickPhoto() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return popup.warn('Permission needed', 'Allow photo library access to attach a student photo.');
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!result.canceled) {
        const asset = result.assets[0];
        if (asset.mimeType && !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType)) {
          popup.warn('Unsupported file', 'Choose a JPEG, PNG, or WebP image.');
          return;
        }
        setPhoto(asset);
      }
    } catch (e: any) { popup.error(e.message, 'Could not open photos'); }
  }

  function continueToFamily() {
    for (const [key, label] of [['name', "Child's full name"], ['dob', 'Date of birth'], ['batchId', 'Class & batch']]) {
      if (!values[key]?.trim()) return popup.warn('Missing information', `${label} is required.`);
    }
    const dob = values.dob.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(dob)) || new Date(dob).toISOString().slice(0, 10) !== dob || new Date(dob) > new Date()) return popup.warn('Invalid date of birth', 'Enter a valid past date using YYYY-MM-DD.');
    if (values.name.trim().length < 2) return popup.warn('Invalid name', 'Enter at least two characters.');
    setStep(2);
  }

  async function saveStudent() {
    if (busy) return;
    for (const [key, label] of [['parentName', 'Parent name'], ['parentPhone', 'Parent phone'], ['parentEmail', 'Parent email'], ['transportMode', 'Pick-up and drop-off']]) {
      if (!values[key]?.trim()) return popup.warn('Missing information', `${label} is required.`);
    }
    if (values.transportMode === 'SCHOOL_VAN' && !values.transportContact?.trim()) return popup.warn('Missing information', 'Enter the van or driver contact number.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.parentEmail.trim())) return popup.warn('Invalid email', 'Enter a valid parent email address.');
    if (values.parentName.trim().length < 2) return popup.warn('Invalid parent name', 'Enter at least two characters.');
    for (const key of ['parentPhone', 'alternateParentPhone', 'transportContact']) {
      if (values[key]?.trim() && (values[key].replace(/\D/g, '').length < 8 || !/^\+?[\d ()-]{8,20}$/.test(values[key].trim()))) return popup.warn('Invalid phone', 'Enter a valid contact number with at least eight digits.');
    }
    setBusy(true);
    try {
      const body = new FormData();
      for (const key of ['name', 'dob', 'batchId', 'homeAddress', 'alternateParentPhone', 'transportMode', 'transportContact', 'photoConsent']) {
        if (values[key]?.trim()) body.append(key, values[key].trim());
      }
      body.append('parent', JSON.stringify({ name: values.parentName.trim(), phone: values.parentPhone.trim(), email: values.parentEmail.trim() }));
      if (document) await appendUploadFile(body, 'identityDocument', document);
      if (photo) await appendUploadFile(body, 'photo', photo);
      const result = await upload<any>('/principal/students', body);
      const batch = batches?.find((entry) => entry.id === values.batchId);
      setResult({ name: result.student.name, detail: batch ? batchLabel(batch) : result.student.admissionNo, login: result.parentLogin, emailSent: result.emailSent, existingAccount: !result.parentAccountCreated, temporaryPassword: result.temporaryPassword });
    } catch (e: any) { popup.error(e.message, 'Could not add student'); }
    finally { setBusy(false); }
  }

  if (result) return <RegistrationSuccess result={result} kind="student" onDone={() => navigation.popTo('PeopleHome', { peopleTab: 'Students' })} onAnother={() => {
    setResult(null); setValues({ transportMode: 'SCHOOL_VAN', photoConsent: 'false' }); setPhoto(null); setDocument(null); setStep(1); reloadBatches();
  }} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={96}>
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.wizardPage} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag">
      <View style={styles.stepHeader}>
        <View style={styles.stepTrack}><View style={[styles.stepProgress, { width: step === 1 ? '50%' : '100%' }]} /></View>
        <Text style={styles.stepCount}>{step} of 2</Text>
      </View>
      <Text style={styles.wizardTitle}>{step === 1 ? 'About the child' : 'Family and pick-up'}</Text>
      <Text style={styles.wizardSubtitle}>{step === 1 ? 'Add your new student’s details.' : 'How can the family be reached, and who will collect the child?'}</Text>

      {step === 1 ? (
        <>
          <WizardInput label="Child’s full name" value={values.name ?? ''} onChange={(v) => set('name', v)} placeholder="e.g. Aarav Mehta" />
          <WizardInput label="Date of birth" value={values.dob ?? ''} onChange={(v) => set('dob', v)} placeholder="YYYY-MM-DD" />
          <Text style={styles.fieldLabel}>Class & batch</Text>
          {batchesError ? <View><Text style={styles.errorText}>{batchesError}</Text><Button label="Retry loading classes" secondary onPress={reloadBatches} /></View> : null}
          {!batches && !batchesError ? <Loading /> : null}
          <View style={styles.choiceList}>{(batches ?? []).map((batch) => (
            <Chip key={batch.id} label={batchLabel(batch)} active={values.batchId === batch.id} onPress={() => set('batchId', batch.id)} />
          ))}</View>
          {batches?.length === 0 ? <Sub>Add a class batch before enrolling a student.</Sub> : null}
          <WizardInput label="Home address" value={values.homeAddress ?? ''} onChange={(v) => set('homeAddress', v)} placeholder="House, street, city" multiline />
          <Text style={styles.fieldLabel}>Student photo <Text style={styles.optionalText}>· optional</Text></Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={photo ? 'Change student photo' : 'Upload student photo'} style={styles.documentPicker} onPress={pickPhoto} activeOpacity={0.8}>
            <Text style={styles.documentIcon}>{photo ? '✅' : '📷'}</Text>
            <View style={{ flex: 1 }}><Text style={styles.documentTitle}>{photo ? photo.fileName ?? 'Photo selected' : 'Add a student photo'}</Text><Text style={styles.wizardSubtitle}>JPEG, PNG or WebP · up to 10 MB</Text></View>
            <Text style={styles.documentAction}>{photo ? 'Change' : 'Upload'}</Text>
          </TouchableOpacity>
          {photo ? <TouchableOpacity accessibilityRole="button" onPress={() => setPhoto(null)}><Text style={styles.removeDocument}>Remove photo</Text></TouchableOpacity> : null}
          <Text style={styles.fieldLabel}>Identity document <Text style={styles.optionalText}>· optional</Text></Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={document ? 'Change identity document' : 'Upload identity document'} style={styles.documentPicker} onPress={pickDocument} activeOpacity={0.8}>
            <Text style={styles.documentIcon}>{document ? '✅' : '📄'}</Text>
            <View style={{ flex: 1 }}><Text style={styles.documentTitle}>{document ? document.fileName ?? 'Document selected' : 'Add a photo of the birth certificate'}</Text><Text style={styles.wizardSubtitle}>Image files · up to 10 MB</Text></View>
            <Text style={styles.documentAction}>{document ? 'Change' : 'Upload'}</Text>
          </TouchableOpacity>
          {document ? <TouchableOpacity accessibilityRole="button" onPress={() => setDocument(null)}><Text style={styles.removeDocument}>Remove attachment</Text></TouchableOpacity> : null}
          <Button label="Next · Family details" onPress={continueToFamily} />
        </>
      ) : (
        <>
          <WizardInput label="Parent / guardian name" value={values.parentName ?? ''} onChange={(v) => set('parentName', v)} placeholder="Full name" />
          <WizardInput label="Parent email" value={values.parentEmail ?? ''} onChange={(v) => set('parentEmail', v)} placeholder="parent@example.com" keyboardType="email-address" />
          <WizardInput label="Primary phone number" value={values.parentPhone ?? ''} onChange={(v) => set('parentPhone', v)} placeholder="+91 98765 43210" keyboardType="phone-pad" />
          <WizardInput label="Second parent / guardian phone" value={values.alternateParentPhone ?? ''} onChange={(v) => set('alternateParentPhone', v)} placeholder="Optional" keyboardType="phone-pad" />
          <Text style={styles.fieldLabel}>Pick-up and drop-off</Text>
          <View style={styles.choiceList}>
            <Chip label="🚌 School van" active={values.transportMode === 'SCHOOL_VAN'} onPress={() => set('transportMode', 'SCHOOL_VAN')} />
            <Chip label="🚶 Personal" active={values.transportMode === 'PERSONAL'} onPress={() => set('transportMode', 'PERSONAL')} />
          </View>
          <WizardInput label={values.transportMode === 'SCHOOL_VAN' ? 'Van / driver contact' : 'Emergency contact'} value={values.transportContact ?? ''} onChange={(v) => set('transportContact', v)} placeholder="Phone number (optional for personal pick-up)" keyboardType="phone-pad" />
          <TouchableOpacity accessibilityRole="checkbox" accessibilityLabel="Parent consent for sharing photos and videos" accessibilityState={{ checked: values.photoConsent === 'true' }} style={styles.consentRow} onPress={() => set('photoConsent', values.photoConsent === 'true' ? 'false' : 'true')} activeOpacity={0.8}>
            <Text style={[styles.checkbox, values.photoConsent === 'true' && styles.checkboxChecked]}>{values.photoConsent === 'true' ? '✓' : ''}</Text>
            <Text style={styles.consentText}>Parent has consented to photos and videos shared with parents.</Text>
          </TouchableOpacity>
          <Button label="← Back to child details" secondary onPress={() => setStep(1)} />
          <Button label="Save and invite parent" onPress={saveStudent} busy={busy} />
        </>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

function EditStudent({ navigation, route }: any) {
  const student = route.params.item;
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [identity, setIdentity] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const fields = peopleForms.EditStudent.fields;
  const initialValues = Object.fromEntries(fields.map((field) => [
    field.key, field.kind === 'date' ? student[field.key]?.slice(0, 10) : String(student[field.key] ?? ''),
  ]));
  const pick = async (kind: 'photo' | 'identity') => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return popup.warn('Permission needed', 'Allow photo library access to update this image.');
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!result.canceled) (kind === 'photo' ? setPhoto : setIdentity)(result.assets[0]);
    } catch (error: any) { popup.error(error.message, 'Could not open photos'); }
  };
  return <FormScreen fields={fields} initialValues={initialValues} submitLabel="Save student changes"
    intro="Update the student profile and securely replace their photo or identity image. Existing files remain unchanged unless replaced."
    topContent={<>
      <Button label={photo ? 'Change selected photo' : 'Upload / replace student photo'} secondary onPress={() => pick('photo')} />
      {photo ? <Image source={{ uri: photo.uri }} style={{ width: 90, height: 90, borderRadius: 45, alignSelf: 'center' }} /> : null}
      <Button label={identity ? 'Identity image selected — change' : 'Upload / replace identity image'} secondary onPress={() => pick('identity')} />
    </>}
    submit={async (body: Record<string, string>) => {
      const form = new FormData();
      Object.entries(body).forEach(([key, value]) => form.append(key, value));
      for (const field of fields) if (field.required === false && !(field.key in body)) form.append(field.key, '');
      if (photo) await appendUploadFile(form, 'photo', photo);
      if (identity) await appendUploadFile(form, 'identityDocument', identity);
      return upload(`/principal/students/${student.id}`, form, 'PATCH');
    }}
    onDone={() => { popup.success(`${student.name}'s profile updated`); navigation.goBack(); }} />;
}

function PeopleHome({ navigation, route }: any) {
  const tab = route.params?.peopleTab ?? 'Students';
  const setTab = (peopleTab: string) => navigation.setParams({ peopleTab });
  const [document, setDocument] = useState<{ studentId?: string; staffId?: string; kind: 'photo' | 'identity' } | null>(null);
  const [profile, setProfile] = useState<{ item: any; kind: 'student' | 'staff' } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [documentLoading, setDocumentLoading] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Segmented tabs={[{ value: 'Students', label: 'Student', icon: '🧒' }, { value: 'Teachers & staff', label: 'Teacher', icon: '👩‍🏫' }]} value={tab} onChange={setTab} />
      {tab === 'Students' ? (
        <ListScreen<any> key="s" path="/principal/students" empty="No students enrolled"
          countLabel="students" searchText={(student) => `${student.name} ${student.admissionNo} ${student.parent.name} ${student.parent.phone} ${student.parent.email ?? ''} ${batchLabel(student.batch)}`}
          filters={[{ label: 'Class & batch', value: (student) => batchLabel(student.batch) }, { label: 'Transport', value: (student) => student.transportMode === 'SCHOOL_VAN' ? 'School van' : student.transportMode === 'PERSONAL' ? 'Personal' : 'Not specified' }]}
          header={<Button label="+ Enrol student" onPress={() => navigation.navigate('AddStudent')} />}
          render={(st, reload) => (
            <Card>
              <Title>{st.name} · {st.admissionNo}</Title>
              <Sub>{batchLabel(st.batch)} · Parent: {st.parent.name} ({st.parent.phone})</Sub>
              <Badge text={st.photoConsent ? 'PHOTO CONSENT' : 'NO PHOTO CONSENT'} color={st.photoConsent ? colors.ok : colors.muted} />
              <Sub>{st.parent.email ?? ''}{st.transportMode ? ` · ${st.transportMode === 'SCHOOL_VAN' ? 'School van' : 'Personal transport'}` : ''}</Sub>
              <ActionRow><Button label="View profile" secondary onPress={() => setProfile({ item: st, kind: 'student' })} />
              <Button label="Edit student" secondary onPress={() => navigation.navigate('EditStudent', { item: st })} /></ActionRow>
              <Button label={expanded[st.id] ? 'Hide additional actions' : 'More actions · documents & access'} secondary onPress={() => setExpanded((previous) => ({ ...previous, [st.id]: !previous[st.id] }))} />
              {expanded[st.id] ? <View style={styles.additionalActions}>
              <Button label={st.photoConsent ? 'Revoke photo consent' : 'Record photo consent'} secondary onPress={async () => {
                try {
                  await api('PATCH', `/principal/students/${st.id}`, { photoConsent: !st.photoConsent });
                  popup.success(st.photoConsent ? 'Consent revoked' : 'Consent recorded', 'Photo sharing access has been updated.');
                  reload();
                } catch (e: any) { popup.error(e.message); }
              }} />
              {st.hasPhoto ? <Button label="View student photo" secondary onPress={() => setDocument({ studentId: st.id, kind: 'photo' })} /> : null}
              {st.hasIdentityDocument ? <Button label="View identity document" secondary onPress={() => setDocument({ studentId: st.id, kind: 'identity' })} /> : null}
              <Button label="Reset parent password" secondary onPress={async () => {
                if (!(await popup.confirm('Reset parent password?', `A temporary password will be issued to ${st.parent.email ?? st.parent.phone}.`, 'Reset password'))) return;
                try { credsAlert({ ...(await api('POST', `/principal/parents/${st.parentId}/reset-password`, {})), login: st.parent.email }, 'parent'); }
                catch (e: any) { popup.error(e.message); }
              }} />
              <Button label="Delete student (mark as left)" secondary danger onPress={async () => {
                if (!(await popup.confirm('Mark student as left?', 'This removes the student from active lists and disables their authorized pickup people.', 'Mark as left', true))) return;
                try { await api('DELETE', `/principal/students/${st.id}`); popup.success('Student marked as left'); reload(); } catch (e: any) { popup.error(e.message); }
              }} />
              </View> : null}
            </Card>
          )} />
      ) : (
        <ListScreen<any> key="t" path="/principal/staff" empty="No staff yet"
          countLabel="teachers & staff" searchText={(staff) => `${staff.name} ${staff.role} ${staff.email ?? ''} ${staff.phone ?? ''} ${staff.designation ?? ''}`}
          filters={[{ label: 'Role', value: (staff) => staff.role }, { label: 'Access', value: (staff) => staff.active ? 'Active' : 'Inactive' }]}
          header={<Button label="+ Add teacher / staff" onPress={() => navigation.navigate('AddStaff')} />}
          render={(u, reload) => (
            <Card>
              <Title>{u.name}</Title>
              <Sub>{u.role}{u.designation ? ` · ${u.designation}` : ''} · {u.phone}</Sub>
              <Sub>{u.email ?? ''}{u.address ? ` · ${u.address}` : ''}</Sub>
              {u.batchesTaught.length ? <Sub>Teaches: {u.batchesTaught.map((b: any) => `${b.class.name} ${b.name}`).join(', ')}</Sub> : null}
              {!u.active ? <Badge text="INACTIVE" color={colors.bad} /> : null}
              <ActionRow><Button label="View profile" secondary onPress={() => setProfile({ item: u, kind: 'staff' })} />
              <Button label="Edit staff details" secondary onPress={() => navigation.navigate('AddStaff', { item: u })} /></ActionRow>
              <Button label={expanded[u.id] ? 'Hide additional actions' : 'More actions · photo & access'} secondary onPress={() => setExpanded((previous) => ({ ...previous, [u.id]: !previous[u.id] }))} />
              {expanded[u.id] ? <View style={styles.additionalActions}>
              {u.hasPhoto ? <Button label="View staff photo" secondary onPress={() => setDocument({ staffId: u.id, kind: 'photo' })} /> : null}
              <Button label="Reset password" secondary onPress={async () => {
                if (!(await popup.confirm('Reset staff password?', `A temporary password will be issued to ${u.email ?? u.phone}.`, 'Reset password'))) return;
                try { credsAlert({ ...(await api('POST', `/principal/staff/${u.id}/reset-password`, {})), login: u.email }, u.name); } catch (e: any) { popup.error(e.message); }
              }} />
              <Button label={u.active ? 'Deactivate staff' : 'Activate staff'} secondary danger={u.active} onPress={async () => {
                if (u.active && !(await popup.confirm('Deactivate staff?', 'They will lose access and any class assignment will be removed.', 'Deactivate', true))) return;
                try { await api('PATCH', `/principal/staff/${u.id}`, { active: !u.active }); popup.success(u.active ? 'Staff deactivated' : 'Staff activated'); reload(); } catch (e: any) { popup.error(e.message); }
              }} />
              {u.active ? <Button label="Delete staff (remove access)" secondary danger onPress={async () => {
                if (!(await popup.confirm(`Delete ${u.name}?`, 'Their login will be disabled and class assignments removed. Historical records are retained.', 'Delete staff', true))) return;
                try { await api('DELETE', `/principal/staff/${u.id}`); popup.success('Staff access removed'); reload(); }
                catch (error: any) { popup.error(error.message); }
              }} /> : null}
              </View> : null}
            </Card>
          )} />
      )}
      <Modal visible={!!profile} animationType="slide" onRequestClose={() => setProfile(null)}>
        <ModalPage>
          <Button label="Close profile" secondary onPress={() => setProfile(null)} />
          {profile ? <>
            <Heading>{profile.item.name}</Heading>
            <Card>
              {profile.kind === 'student' ? <>
                <Title>{profile.item.admissionNo} · {batchLabel(profile.item.batch)}</Title>
                <Sub>Date of birth: {day(profile.item.dob)}</Sub>
                <Sub>Gender: {profile.item.gender || 'Not specified'} · Blood group: {profile.item.bloodGroup || 'Not specified'}</Sub>
                <Sub>Allergies: {profile.item.allergies || 'None recorded'}</Sub>
                <Sub>Address: {profile.item.homeAddress || 'Not provided'}</Sub>
                <Sub>Parent: {profile.item.parent.name}</Sub>
                <Sub>{profile.item.parent.email} · {profile.item.parent.phone}</Sub>
                <Sub>Alternate phone: {profile.item.alternateParentPhone || 'Not provided'}</Sub>
                <Sub>Transport: {profile.item.transportMode === 'SCHOOL_VAN' ? 'School van' : profile.item.transportMode === 'PERSONAL' ? 'Personal' : 'Not specified'}</Sub>
                <Sub>Transport contact: {profile.item.transportContact || 'Not provided'}</Sub>
                <Sub>Photo consent: {profile.item.photoConsent ? 'Granted' : 'Not granted'}</Sub>
                <Sub>Joined: {day(profile.item.admissionDate)}</Sub>
              </> : <>
                <Title>{profile.item.role} · {profile.item.active ? 'Active' : 'Inactive'}</Title>
                <Sub>Email: {profile.item.email}</Sub><Sub>Phone: {profile.item.phone}</Sub>
                <Sub>Designation: {profile.item.designation || 'Not specified'}</Sub>
                <Sub>Address: {profile.item.address || 'Not provided'}</Sub>
                <Sub>Monthly salary: {profile.item.salary == null ? 'Not provided' : money(profile.item.salary * 100)}</Sub>
                <Sub>Classes: {profile.item.batchesTaught.map(batchLabel).join(', ') || 'Unassigned'}</Sub>
              </>}
            </Card>
            <Button label="Edit profile" onPress={() => {
              navigation.navigate(profile.kind === 'student' ? 'EditStudent' : 'AddStaff', { item: profile.item }); setProfile(null);
            }} />
          </> : null}
        </ModalPage>
      </Modal>
      <Modal visible={!!document} transparent animationType="fade" onRequestClose={() => setDocument(null)}>
        <SafeAreaView style={styles.documentBackdrop}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close private document" style={styles.closeDocument} onPress={() => setDocument(null)}><Text style={styles.closeDocumentText}>Close document</Text></TouchableOpacity>
          {documentLoading ? <ActivityIndicator color="#fff" accessibilityLabel="Loading private document" /> : null}
          {document ? <Image
            key={`${document.staffId ?? document.studentId}-${document.kind}`}
            source={{ uri: document.staffId ? `${BASE}/principal/staff/${document.staffId}/photo` : `${BASE}/principal/students/${document.studentId}/private-documents/${document.kind}`, headers: authHeaders() }}
            onLoadStart={() => setDocumentLoading(true)} onLoadEnd={() => setDocumentLoading(false)}
            onError={() => { setDocument(null); popup.error('The private image could not be loaded. Check your connection and try again.'); }}
            resizeMode="contain" style={styles.documentPreview}
          /> : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}
const PeopleStack = () => (
  <Stack.Navigator screenOptions={{ animation: 'slide_from_right' }}>
    <Stack.Screen name="PeopleHome" component={PeopleHome} options={{ title: 'People' }} />
    <Stack.Screen name="AddStudent" component={StudentWizard} options={{ title: 'Add student' }} />
    <Stack.Screen name="AddStaff" component={StaffForm} options={{ title: 'Teacher / staff' }} />
    <Stack.Screen name="EditStudent" component={EditStudent} options={{ title: 'Edit student' }} />
  </Stack.Navigator>
);

// ---------- Fees ----------
interface Invoice {
  id: string; studentId: string; feeStructureId: string; period: string; amount: number; paidAmount: number; dueDate: string;
  status: 'PENDING' | 'PARTIAL' | 'PAID';
  student: { id: string; name: string; admissionNo: string; batch: { name: string; class: { name: string } } };
  feeStructure: { name: string };
  payments: { id: string; amount: number; method: string; reference: string | null; paidAt: string }[];
}
interface InvoiceStudent { id: string; name: string; admissionNo: string; batchId: string; batch: { name: string; class: { name: string } } }
interface InvoiceFee { id: string; name: string; classId: string; amount: number; dueDay: number; frequency: string }
interface InvoiceBatch { id: string; classId: string }

function invoiceOverdue(invoice: Invoice) {
  return invoice.status !== 'PAID' && new Date(invoice.dueDate).getTime() < new Date(`${isoToday()}T00:00:00`).getTime();
}

function GenerateInvoice({ navigation }: any) {
  const students = useFetch<InvoiceStudent[]>('/principal/students');
  const fees = useFetch<InvoiceFee[]>('/principal/fee-structures');
  const batches = useFetch<InvoiceBatch[]>('/principal/batches');
  const [studentId, setStudentId] = useState('');
  const [feeId, setFeeId] = useState('');
  const [query, setQuery] = useState('');
  const student = students.data?.find((entry) => entry.id === studentId);
  const classId = batches.data?.find((entry) => entry.id === student?.batchId)?.classId;
  const matchingFees = (fees.data ?? []).filter((entry) => entry.classId === classId);
  const fee = matchingFees.find((entry) => entry.id === feeId);
  const error = students.err || fees.err || batches.err;
  if (error) return <Page><Sub>{error}</Sub><Button label="Retry loading invoice options" onPress={() => { students.reload(); fees.reload(); batches.reload(); }} /></Page>;
  if (!students.data || !fees.data || !batches.data) return <Loading />;
  if (!students.data.length) return <Page><Heading>No students enrolled</Heading><Sub>Register a student before generating an invoice.</Sub><Button label="Back to fees" onPress={() => navigation.goBack()} /></Page>;
  return <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <FormScreen key={`${studentId}:${feeId}`} submitLabel="Generate Invoice"
      intro="Choose a student and class fee plan. Review the amount, billing month and due date before saving."
      topContent={<>
        <Heading>Student</Heading>
        <TextInput accessibilityLabel="Search students for invoice" style={styles.fieldInput} placeholder="Search name or admission number" value={query} onChangeText={setQuery} />
        {student ? <Card><Title>{student.name}</Title><Sub>{student.admissionNo} · {batchLabel(student.batch)}</Sub></Card> : null}
        <ScrollView style={{ maxHeight: 190 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          <View style={styles.choiceList}>
            {students.data.filter((entry) => `${entry.name} ${entry.admissionNo}`.toLowerCase().includes(query.trim().toLowerCase())).map((entry) =>
              <Chip key={entry.id} label={`${entry.name} · ${entry.admissionNo}`} active={studentId === entry.id} onPress={() => { setStudentId(entry.id); setFeeId(''); }} />)}
          </View>
          {!students.data.some((entry) => `${entry.name} ${entry.admissionNo}`.toLowerCase().includes(query.trim().toLowerCase())) ? <Sub>No matching students.</Sub> : null}
        </ScrollView>
        <Heading>Fee details</Heading>
        {!student ? <Sub>Select a student to see their class fee plans.</Sub> : matchingFees.length ? <View style={styles.choiceList}>
          {matchingFees.map((entry) => <Chip key={entry.id} label={`${entry.name} · ${money(entry.amount)}`} active={feeId === entry.id} onPress={() => setFeeId(entry.id)} />)}
        </View> : <Sub>No fee plans for this class. Add one under Classes → Fee before continuing.</Sub>}
        {fee ? <Card><Title>{fee.name}</Title><Sub>{fee.frequency.replace('_', ' ')} · Standard amount {money(fee.amount)}</Sub><Sub>The saved invoice amount can differ from the standard plan without changing it.</Sub></Card> : null}
      </>}
      fields={fee ? [
        { key: 'amount', label: 'Invoice amount (₹)', kind: 'money', min: 0.01, max: 21474836.47 },
        { key: 'period', label: 'Billing month (YYYY-MM)', placeholder: '2026-10' },
        { key: 'dueDate', label: 'Due date', kind: 'date' },
      ] : []}
      initialValues={fee ? { amount: String(fee.amount / 100), period: isoToday().slice(0, 7), dueDate: `${isoToday().slice(0, 7)}-${String(fee.dueDay).padStart(2, '0')}` } : undefined}
      submit={async (body: { amount?: number; period?: string; dueDate?: string }) => {
        if (!student || !fee) throw new Error('Select a student and a fee plan before generating an invoice.');
        if (!body.amount || body.amount <= 0) throw new Error('Enter a positive invoice amount.');
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.period ?? '')) throw new Error('Enter a billing month in YYYY-MM format.');
        return api<Invoice>('POST', '/principal/invoices', { ...body, studentId: student.id, feeStructureId: fee.id });
      }}
      onDone={(invoice: Invoice) => {
        popup.success('Invoice generated!', `${invoice.student.name} · ${money(invoice.amount)} · Due ${day(invoice.dueDate)}`, { emoji: '🧾' });
        navigation.replace('ViewInvoices');
      }} />
  </View>;
}

function FeesHome({ navigation }: any) {
  return <Page>
    <ScreenHeader title="Fees, made simple" subtitle="Create an invoice for one student, review all invoices, and track payments in one place." icon="💰" />
    <Card><Text style={styles.actionEmoji}>🧾</Text><Title>Generate Invoice</Title><Sub>Select a student and fee plan, set the amount and due date, then save.</Sub><Button label="Generate Invoice" onPress={() => navigation.navigate('GenerateInvoice')} /></Card>
    <Card><Text style={styles.actionEmoji}>📋</Text><Title>View Invoices</Title><Sub>Search all saved invoices, filter payment status, and record collections.</Sub><Button label="View Invoices" onPress={() => navigation.navigate('ViewInvoices')} /></Card>
  </Page>;
}

function ViewInvoices({ navigation }: any) {
  const [status, setStatus] = useState('ALL');
  const [version, setVersion] = useState(0);
  const [generating, setGenerating] = useState(false);
  return <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <Segmented tabs={[{ value: 'ALL', label: 'All' }, { value: 'OPEN', label: 'Due' }, { value: 'PAID', label: 'Paid' }]} value={status} onChange={setStatus} />
    <ListScreen<Invoice> key={`${status}:${version}`} path={`/principal/invoices${status === 'ALL' ? '' : `?status=${status}`}`} empty="No invoices yet"
      countLabel="invoices" searchText={(invoice) => `${invoice.id} ${invoice.student.name} ${invoice.student.admissionNo} ${invoice.feeStructure.name} ${invoice.period} ${batchLabel(invoice.student.batch)} ${invoice.payments.map((payment) => payment.reference ?? '').join(' ')}`}
      filters={[{ label: 'Class & batch', value: (invoice) => batchLabel(invoice.student.batch) }, { label: 'Payment status', value: (invoice) => invoice.status === 'PAID' ? 'Paid' : invoice.status === 'PARTIAL' ? 'Partially paid' : 'Unpaid' }, { label: 'Due date', value: (invoice) => invoice.status === 'PAID' ? 'Settled' : invoiceOverdue(invoice) ? 'Overdue' : 'Upcoming' }]}
      header={<>
        <Button label="+ Generate Invoice" onPress={() => navigation.navigate('GenerateInvoice')} />
        <Button label="Generate this month's class invoices" secondary busy={generating} onPress={async () => {
          if (generating) return;
          if (!(await popup.confirm('Generate monthly invoices?', 'This creates all missing scheduled invoices for active students. Existing invoices are not changed.', 'Generate invoices'))) return;
          setGenerating(true);
          try { const response = await api<{ created: number }>('POST', '/principal/invoices/generate', {}); popup.success('Invoices generated', `${response.created} new invoices created.`); setVersion((previous) => previous + 1); }
          catch (error: any) { popup.error(error.message); }
          finally { setGenerating(false); }
        }} />
      </>}
      render={(invoice) => <Card>
        <Title>{invoice.student.name}</Title><Sub>{invoice.student.admissionNo} · {batchLabel(invoice.student.batch)}</Sub>
        <Title>{invoice.feeStructure.name} · {invoice.period}</Title>
        <Sub>Total {money(invoice.amount)} · Received {money(invoice.paidAmount)}</Sub>
        <Sub>Balance {money(invoice.amount - invoice.paidAmount)} · Due {day(invoice.dueDate)}</Sub>
        <Badge text={invoice.status === 'PAID' ? 'PAID' : invoice.status === 'PARTIAL' ? 'PARTIALLY PAID' : 'UNPAID'} color={invoice.status === 'PAID' ? colors.ok : colors.warn} />
        {invoiceOverdue(invoice) ? <Badge text="OVERDUE" color={colors.bad} /> : null}
        <Button label="View invoice details" secondary onPress={() => navigation.navigate('InvoiceDetails', { id: invoice.id })} />
        {invoice.status !== 'PAID' ? <Button label="Record payment" onPress={() => navigation.navigate('RecordPayment', { id: invoice.id })} /> : null}
      </Card>} />
  </View>;
}

function InvoiceDetails({ navigation, route }: any) {
  const { data: invoice, err, reload } = useFetch<Invoice>(`/principal/invoices/${route.params.id}`);
  if (!invoice) return err ? <Page><Sub>{err}</Sub><Button label="Retry loading invoice" onPress={reload} /></Page> : <Loading />;
  return <Page onRefresh={reload}>
    <Heading>{invoice.student.name}</Heading><Sub>{invoice.student.admissionNo} · {batchLabel(invoice.student.batch)}</Sub>
    {err ? <Sub>{err}</Sub> : null}
    <Card><Title>{invoice.feeStructure.name}</Title><Sub>Invoice ID: {invoice.id}</Sub><Sub>Billing month: {invoice.period}</Sub><Sub>Due date: {day(invoice.dueDate)}</Sub>
      <Sub>Total: {money(invoice.amount)}</Sub><Sub>Paid: {money(invoice.paidAmount)}</Sub><Title>Balance: {money(invoice.amount - invoice.paidAmount)}</Title>
      <Badge text={invoice.status.replace('_', ' ')} color={invoice.status === 'PAID' ? colors.ok : colors.warn} />
      {invoiceOverdue(invoice) ? <Badge text="OVERDUE" color={colors.bad} /> : null}
    </Card>
    <Heading>Transaction history</Heading>
    {invoice.payments.length ? invoice.payments.map((payment) => <Card key={payment.id}>
      <Title>{money(payment.amount)} · {payment.method}</Title><Sub>{day(payment.paidAt)}</Sub><Sub>Reference: {payment.reference || 'Not provided'}</Sub>
    </Card>) : <Card><Sub>No payments recorded yet.</Sub></Card>}
    {invoice.status !== 'PAID' ? <Button label="Record payment" onPress={() => navigation.navigate('RecordPayment', { id: invoice.id })} /> : null}
  </Page>;
}

function RecordPayment({ navigation, route }: any) {
  const { data: invoice, err, reload } = useFetch<Invoice>(`/principal/invoices/${route.params.id}`);
  if (!invoice) return err ? <Page><Sub>{err}</Sub><Button label="Retry loading invoice" onPress={reload} /></Page> : <Loading />;
  if (invoice.status === 'PAID') return <Page><Heading>Invoice already paid</Heading><Sub>No outstanding balance remains.</Sub><Button label="View Invoices" onPress={() => navigation.popTo('ViewInvoices')} /></Page>;
  return <FormScreen key={`${invoice.id}:${invoice.paidAmount}`} submitLabel="Save payment"
    intro={`Payment for ${invoice.student.name} · ${invoice.feeStructure.name}. Balance: ${money(invoice.amount - invoice.paidAmount)}.`}
    fields={[
      { key: 'amount', label: 'Amount received (₹)', kind: 'money' },
      { key: 'method', label: 'Payment method', kind: 'select', options: ['CASH', 'UPI', 'CARD', 'BANK'].map((method) => ({ value: method, label: method })) },
      { key: 'reference', label: 'Transaction reference', required: false },
    ]}
    initialValues={{ amount: ((invoice.amount - invoice.paidAmount) / 100).toFixed(2), method: 'CASH' }}
    submit={(body: { amount: number; method: string; reference?: string }) => {
      if (body.amount <= 0 || body.amount > invoice.amount - invoice.paidAmount) throw new Error('Enter a positive amount no greater than the remaining balance.');
      return api('POST', `/principal/invoices/${invoice.id}/payments`, body);
    }}
    onDone={() => { popup.success('Payment recorded!', `${invoice.student.name}'s balance has been updated.`, { emoji: '💰' }); navigation.goBack(); }} />;
}
const FeesStack = () => (
  <Stack.Navigator screenOptions={{ animation: 'slide_from_right' }}>
    <Stack.Screen name="FeesHome" component={FeesHome} options={{ title: 'Fee collection' }} />
    <Stack.Screen name="GenerateInvoice" component={GenerateInvoice} options={{ title: 'Generate Invoice' }} />
    <Stack.Screen name="ViewInvoices" component={ViewInvoices} options={{ title: 'View Invoices' }} />
    <Stack.Screen name="InvoiceDetails" component={InvoiceDetails} options={{ title: 'Invoice details' }} />
    <Stack.Screen name="RecordPayment" component={RecordPayment} options={{ title: 'Record payment' }} />
  </Stack.Navigator>
);

const Tabs = createBottomTabNavigator();
export function PrincipalApp() {
  const icons: Record<string, string> = { Home: '🏠', Classes: '🏫', People: '👥', Fees: '💰', More: '⋯' };
  return (
    <Tabs.Navigator screenOptions={({ route }) => ({
      headerShown: false, tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.muted,
      tabBarHideOnKeyboard: true,
      tabBarIcon: () => <Text accessible={false} allowFontScaling={false} style={{ fontSize: 21, lineHeight: 26 }}>{icons[route.name]}</Text>,
      tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, paddingTop: 5, elevation: 8 },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
    })}>
      <Tabs.Screen name="Home" component={HomeStack} />
      <Tabs.Screen name="Classes" component={ClassesStack} />
      <Tabs.Screen name="People" component={PeopleStack} />
      <Tabs.Screen name="Fees" component={FeesStack} />
      <Tabs.Screen name="More" component={MoreStack} />
    </Tabs.Navigator>
  );
}

const styles = StyleSheet.create({
  welcome: { marginBottom: 8 },
  additionalActions: { padding: 10, marginTop: 8, borderRadius: 14, backgroundColor: '#f7f8f5', borderWidth: 1, borderColor: colors.border },
  principalPill: { alignSelf: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, backgroundColor: '#e8f6ef', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10, maxWidth: '100%' },
  principalPillText: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  welcomeHint: { color: colors.muted, fontSize: 12, marginTop: 4 },
  greeting: { color: colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  attendanceCard: { backgroundColor: colors.primary, borderRadius: 22, padding: 18, marginTop: 8, marginBottom: 10 },
  attendanceHeader: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' },
  attendanceLabel: { color: '#e6fff4', fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  attendancePercent: { color: '#fff', backgroundColor: '#ffffff30', overflow: 'hidden', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: '700' },
  attendanceCount: { color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 10 },
  attendanceTotal: { fontSize: 15, fontWeight: '600' },
  progressTrack: { height: 8, borderRadius: 5, backgroundColor: '#ffffff50', overflow: 'hidden', marginTop: 12 },
  progressBar: { height: '100%', borderRadius: 5, backgroundColor: '#ffe17a' },
  attendanceLegend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 12 },
  attendanceLegendText: { color: '#fff', fontSize: 11, fontWeight: '600', marginRight: 8, marginTop: 3 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  statCard: { flexBasis: 86, flexGrow: 1, minWidth: 0, maxWidth: '100%', minHeight: 110, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 17, padding: 12, alignItems: 'flex-start', justifyContent: 'center' },
  statEmoji: { fontSize: 18 },
  statNumber: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 5 },
  statLabel: { color: colors.muted, fontSize: 13, marginTop: 4 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  actionCard: { flexBasis: 150, flexGrow: 1, minWidth: 0, maxWidth: '100%', minHeight: 125, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 17, padding: 15, justifyContent: 'center' },
  actionEmoji: { fontSize: 21, marginBottom: 5 },
  actionTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  actionHint: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 4 },
  weekRow: { flexDirection: 'row', alignItems: 'center' },
  weekIcon: { fontSize: 23, marginRight: 12 },
  wizardPage: { padding: 18, paddingBottom: 40, width: '100%', maxWidth: 760, alignSelf: 'center' },
  stepHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  stepTrack: { height: 5, backgroundColor: '#e8e9eb', borderRadius: 4, flex: 1, overflow: 'hidden' },
  stepProgress: { height: 5, backgroundColor: colors.primary, borderRadius: 4 },
  stepCount: { color: colors.muted, fontSize: 11, fontWeight: '700', marginLeft: 10 },
  wizardTitle: { fontSize: 21, color: colors.text, fontWeight: '800' },
  wizardSubtitle: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 10 },
  wizardField: { marginTop: 12, marginBottom: 5 },
  fieldLabel: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  fieldInput: { minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 12, color: colors.text, fontSize: 15 },
  multilineInput: { minHeight: 76, paddingTop: 12 },
  choiceList: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  optionalText: { color: colors.muted, fontWeight: '400' },
  documentPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, minHeight: 64, alignItems: 'center', borderColor: colors.border, borderStyle: 'dashed', borderWidth: 1, borderRadius: 14, padding: 12, backgroundColor: '#fff', marginTop: 4 },
  documentIcon: { fontSize: 20, marginRight: 10 },
  documentTitle: { color: colors.text, fontWeight: '700', fontSize: 12 },
  documentAction: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  removeDocument: { color: colors.bad, fontSize: 13, lineHeight: 20, paddingVertical: 12, marginTop: 6 },
  consentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  checkbox: { width: 21, height: 21, borderWidth: 1, borderColor: colors.border, borderRadius: 6, textAlign: 'center', textAlignVertical: 'center', color: '#fff', marginRight: 10 },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  consentText: { color: colors.muted, fontSize: 12, lineHeight: 18, flex: 1 },
  documentBackdrop: { flex: 1, backgroundColor: '#18221eeF', justifyContent: 'center', alignItems: 'center', padding: 18 },
  closeDocument: { alignSelf: 'flex-end', padding: 12 },
  closeDocumentText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  documentPreview: { width: '100%', height: '82%' },
  errorText: { color: colors.bad, fontSize: 12, marginBottom: 6 },
});
