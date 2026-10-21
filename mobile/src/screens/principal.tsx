import React, { useState } from 'react';
import { Alert } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { api } from '../api';
import { Badge, Button, Card, Heading, ListScreen, Loading, Page, Segmented, Sub, Title, colors, day, money, useFetch } from '../ui';
import { MoreStack } from './principalMore';
import { FormDef, Stack, batchLabel, batchOpt, classOpt, credsAlert, formScreens } from './shared';

// ---------- Home ----------
function Dashboard({ navigation }: any) {
  const { data, reload } = useFetch<any>('/principal/dashboard');
  if (!data) return <Loading />;
  const a = data.attendanceToday ?? {};
  return (
    <Page onRefresh={reload}>
      <Heading>Today</Heading>
      <Card><Title>{data.students} students · {data.batches} batches · {data.staff} staff</Title></Card>
      <Card><Title>Attendance</Title><Sub>Present {a.PRESENT ?? 0} · Late {a.LATE ?? 0} · Absent {a.ABSENT ?? 0}</Sub></Card>
      <Card onPress={() => navigation.navigate('More', { screen: 'Pickups' })}>
        <Title>Pick-up requests</Title>
        <Sub>{data.pendingPickups ? `${data.pendingPickups} waiting for approval` : 'No pending requests'}</Sub>
        {data.pendingPickups ? <Badge text="ACTION NEEDED" color={colors.warn} /> : null}
      </Card>
      <Card onPress={() => navigation.navigate('Fees')}>
        <Title>Fees outstanding: {money(data.feesOutstanding)}</Title>
        <Sub>Overdue: {money(data.feesOverdue)}</Sub>
      </Card>
    </Page>
  );
}
const HomeStack = () => (
  <Stack.Navigator><Stack.Screen name="Dashboard" component={Dashboard} options={{ title: 'Principal dashboard' }} /></Stack.Navigator>
);

// ---------- Classes, batches, fee plans ----------
const FREQ = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME'].map((v) => ({ value: v, label: v }));
const classForms: Record<string, FormDef> = {
  AddClass: { title: 'Add class', post: '/principal/classes', fields: [{ key: 'name', label: 'Class name', placeholder: 'Jr KG' }] },
  AddBatch: {
    title: 'Add batch', post: '/principal/batches',
    fields: [
      { key: 'classId', label: 'Class', ...classOpt },
      { key: 'name', label: 'Shift', kind: 'select', options: ['Morning', 'Noon', 'Afternoon'].map((v) => ({ value: v, label: v })) },
      { key: 'startTime', label: 'Start time', kind: 'time', required: false }, { key: 'endTime', label: 'End time', kind: 'time', required: false },
      { key: 'academicYear', label: 'Academic year', placeholder: '2026-27' },
      { key: 'capacity', label: 'Capacity', kind: 'number', required: false },
      { key: 'teacherId', label: 'Class teacher', kind: 'select', optionsPath: '/principal/staff', optionFilter: (u) => u.role === 'TEACHER' && u.active, optionLabel: (u) => u.name, required: false },
    ],
  },
  AddFee: {
    title: 'Add fee', post: '/principal/fee-structures',
    fields: [
      { key: 'classId', label: 'Class', ...classOpt }, { key: 'name', label: 'Fee name', placeholder: 'Tuition' },
      { key: 'amount', label: 'Amount (₹)', kind: 'money' }, { key: 'frequency', label: 'Frequency', kind: 'select', options: FREQ },
      { key: 'dueDay', label: 'Due day of month (1-28)', kind: 'number', required: false },
    ],
  },
};

function ClassesHome({ navigation }: any) {
  const [tab, setTab] = useState('Classes');
  const add = (label: string, screen: string) => <Button label={label} onPress={() => navigation.navigate(screen)} />;
  return (
    <>
      <Segmented tabs={['Classes', 'Batches', 'Fee plans']} value={tab} onChange={setTab} />
      {tab === 'Classes' && (
        <ListScreen<any> key="c" path="/principal/classes" header={add('+ Add class (Jr KG, Sr KG...)', 'AddClass')}
          render={(c) => <Card><Title>{c.name}</Title><Sub>{c._count.batches} batches · {c.feeStructures.length} fee items</Sub></Card>} />
      )}
      {tab === 'Batches' && (
        <ListScreen<any> key="b" path="/principal/batches" header={add('+ Add batch (Morning / Noon)', 'AddBatch')}
          render={(b, reload) => (
            <Card onPress={() => Alert.alert(batchLabel(b), 'Remove the class teacher?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Unassign teacher', onPress: async () => { await api('PATCH', `/principal/batches/${b.id}`, { teacherId: null }); reload(); } },
            ])}>
              <Title>{batchLabel(b)}</Title>
              <Sub>{b.startTime ?? '--'} – {b.endTime ?? '--'} · {b.academicYear}</Sub>
              <Sub>Teacher: {b.teacher?.name ?? 'unassigned'} · {b._count.students}/{b.capacity} students</Sub>
            </Card>
          )} />
      )}
      {tab === 'Fee plans' && (
        <ListScreen<any> key="f" path="/principal/fee-structures" header={add('+ Add fee', 'AddFee')}
          render={(f, reload) => (
            <Card onPress={() => Alert.alert(`${f.class.name} – ${f.name}`, 'Delete this fee? (not possible once invoices exist)', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: async () => { await api('DELETE', `/principal/fee-structures/${f.id}`).catch((e) => Alert.alert('Error', e.message)); reload(); } },
            ])}>
              <Title>{f.class.name} · {f.name}</Title><Sub>{money(f.amount)} {f.frequency} · due on day {f.dueDay}</Sub>
            </Card>
          )} />
      )}
    </>
  );
}
const ClassesStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="ClassesHome" component={ClassesHome} options={{ title: 'Classes & fees' }} />
    {formScreens(classForms)}
  </Stack.Navigator>
);

// ---------- People ----------
const peopleForms: Record<string, FormDef> = {
  AddStudent: {
    title: 'Enrol student', post: '/principal/students',
    intro: 'A parent account is created automatically and the login is emailed to the parent.',
    fields: [
      { key: 'batchId', label: 'Class & batch', ...batchOpt },
      { key: 'name', label: 'Child name' }, { key: 'dob', label: 'Date of birth', kind: 'date' },
      { key: 'gender', label: 'Gender', kind: 'select', options: ['Male', 'Female', 'Other'].map((v) => ({ value: v, label: v })), required: false },
      { key: 'bloodGroup', label: 'Blood group', required: false }, { key: 'allergies', label: 'Allergies', required: false },
      { key: 'parent.name', label: 'Parent name' }, { key: 'parent.phone', label: 'Parent phone', kind: 'phone' }, { key: 'parent.email', label: 'Parent email', kind: 'email' },
    ],
    after: (r) => credsAlert(r, 'the parent'),
  },
  AddStaff: {
    title: 'Add teacher / staff', post: '/principal/staff',
    intro: 'Login details are emailed to the staff member.',
    fields: [
      { key: 'name', label: 'Name' }, { key: 'role', label: 'Role', kind: 'select', options: ['TEACHER', 'HELPER', 'STAFF'].map((v) => ({ value: v, label: v })) },
      { key: 'email', label: 'Email', kind: 'email' }, { key: 'phone', label: 'Phone', kind: 'phone' },
      { key: 'designation', label: 'Designation', required: false }, { key: 'salary', label: 'Monthly salary (₹)', kind: 'number', required: false },
    ],
    after: (r) => credsAlert(r, 'the staff member'),
  },
};

function PeopleHome({ navigation }: any) {
  const [tab, setTab] = useState('Students');
  return (
    <>
      <Segmented tabs={['Students', 'Teachers & staff']} value={tab} onChange={setTab} />
      {tab === 'Students' ? (
        <ListScreen<any> key="s" path="/principal/students" empty="No students enrolled"
          header={<Button label="+ Enrol student" onPress={() => navigation.navigate('AddStudent')} />}
          render={(st, reload) => (
            <Card onPress={() => Alert.alert(st.name, `Parent: ${st.parent.name}\n${st.parent.phone}\n${st.parent.email ?? ''}`, [
              { text: 'Close', style: 'cancel' },
              { text: 'Reset parent password', onPress: async () => { try { credsAlert({ ...(await api('POST', `/principal/parents/${st.parentId}/reset-password`, {})), login: st.parent.email }, 'parent'); } catch (e: any) { Alert.alert('Error', e.message); } } },
              { text: 'Mark as left', style: 'destructive', onPress: async () => { await api('PATCH', `/principal/students/${st.id}`, { status: 'LEFT' }); reload(); } },
            ])}>
              <Title>{st.name} · {st.admissionNo}</Title>
              <Sub>{batchLabel(st.batch)} · Parent: {st.parent.name} ({st.parent.phone})</Sub>
            </Card>
          )} />
      ) : (
        <ListScreen<any> key="t" path="/principal/staff" empty="No staff yet"
          header={<Button label="+ Add teacher / staff" onPress={() => navigation.navigate('AddStaff')} />}
          render={(u, reload) => (
            <Card onPress={() => Alert.alert(u.name, `${u.role} · ${u.email ?? ''}`, [
              { text: 'Close', style: 'cancel' },
              { text: 'Reset password', onPress: async () => { try { credsAlert({ ...(await api('POST', `/principal/staff/${u.id}/reset-password`, {})), login: u.email }, u.name); } catch (e: any) { Alert.alert('Error', e.message); } } },
              { text: u.active ? 'Deactivate' : 'Activate', style: u.active ? 'destructive' : 'default', onPress: async () => { await api('PATCH', `/principal/staff/${u.id}`, { active: !u.active }); reload(); } },
            ])}>
              <Title>{u.name}</Title>
              <Sub>{u.role}{u.designation ? ` · ${u.designation}` : ''} · {u.phone}</Sub>
              {u.batchesTaught.length ? <Sub>Teaches: {u.batchesTaught.map((b: any) => `${b.class.name} ${b.name}`).join(', ')}</Sub> : null}
              {!u.active ? <Badge text="INACTIVE" color={colors.bad} /> : null}
            </Card>
          )} />
      )}
    </>
  );
}
const PeopleStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="PeopleHome" component={PeopleHome} options={{ title: 'People' }} />
    {formScreens(peopleForms)}
  </Stack.Navigator>
);

// ---------- Fees ----------
function FeesHome() {
  const [tab, setTab] = useState('Due');
  const [v, setV] = useState(0);
  const pay = (inv: any, reload: () => void) => Alert.alert('Record payment', `${money(inv.amount - inv.paidAmount)} for ${inv.student.name}`, [
    { text: 'Cancel', style: 'cancel' },
    ...(['CASH', 'UPI', 'CARD', 'BANK'] as const).map((m) => ({
      text: m, onPress: async () => { await api('POST', `/principal/invoices/${inv.id}/payments`, { amount: inv.amount - inv.paidAmount, method: m }).catch((e) => Alert.alert('Error', e.message)); reload(); },
    })),
  ]);
  return (
    <>
      <Segmented tabs={['Due', 'Paid']} value={tab} onChange={setTab} />
      <ListScreen<any> key={tab + v} path={`/principal/invoices?status=${tab === 'Due' ? 'OPEN' : 'PAID'}`} empty="No invoices"
        header={tab === 'Due' ? <Button label="Generate this month's invoices" secondary onPress={async () => {
          try { const r = await api('POST', '/principal/invoices/generate', {}); Alert.alert('Done', `${r.created} new invoices created`); setV((x) => x + 1); } catch (e: any) { Alert.alert('Error', e.message); }
        }} /> : undefined}
        render={(i, reload) => (
          <Card onPress={tab === 'Due' ? () => pay(i, reload) : undefined}>
            <Title>{i.student.name} · {i.feeStructure.name} ({i.period})</Title>
            <Sub>{batchLabel(i.student.batch)}</Sub>
            <Sub>{tab === 'Due' ? `${money(i.amount - i.paidAmount)} due by ${day(i.dueDate)}` : money(i.amount)}</Sub>
            {tab === 'Due' && new Date(i.dueDate) < new Date() ? <Badge text="OVERDUE" color={colors.bad} /> : null}
            {i.status === 'PARTIAL' ? <Badge text="PARTIAL" color={colors.warn} /> : null}
          </Card>
        )} />
    </>
  );
}
const FeesStack = () => (
  <Stack.Navigator><Stack.Screen name="FeesHome" component={FeesHome} options={{ title: 'Fee collection' }} /></Stack.Navigator>
);

const Tabs = createBottomTabNavigator();
export function PrincipalApp() {
  const icons: Record<string, string> = { Home: '🏠', Classes: '🏫', People: '👥', Fees: '💰', More: '⋯' };
  return (
    <Tabs.Navigator screenOptions={({ route }) => ({
      headerShown: false, tabBarActiveTintColor: colors.primary,
      tabBarIcon: () => <Title>{icons[route.name]}</Title>,
    })}>
      <Tabs.Screen name="Home" component={HomeStack} />
      <Tabs.Screen name="Classes" component={ClassesStack} />
      <Tabs.Screen name="People" component={PeopleStack} />
      <Tabs.Screen name="Fees" component={FeesStack} />
      <Tabs.Screen name="More" component={MoreStack} />
    </Tabs.Navigator>
  );
}

