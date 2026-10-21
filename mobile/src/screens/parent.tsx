import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { api } from '../api';
import { Badge, Button, Card, Chip, FormScreen, Heading, ListScreen, Loading, Page, Segmented, Sub, Title, colors, day, money, useFetch } from '../ui';
import { MediaGrid } from './media';
import { NotificationsScreen, ProfileScreen } from './common';
import { Stack } from './shared';

const Tabs = createBottomTabNavigator();
const STATUS_COLOR: Record<string, string> = { PENDING: colors.warn, APPROVED: colors.ok, COMPLETED: colors.ok, REJECTED: colors.bad, CANCELLED: colors.muted, PRESENT: colors.ok, LATE: colors.warn, ABSENT: colors.bad };

function AttendanceStats({ s }: { s: any }) {
  return (
    <Card>
      <Title>{s.percentage == null ? 'No attendance recorded' : `${s.percentage}% attendance`}</Title>
      <Sub>Present {s.present} · Late {s.late}{s.totalLateMinutes ? ` (${s.totalLateMinutes} min)` : ''} · Absent {s.absent}</Sub>
    </Card>
  );
}
const DayRow = ({ d }: { d: any }) => (
  <Card>
    <Title>{day(d.date)}</Title>
    <Badge text={d.status === 'LATE' ? `LATE · ${d.lateMinutes} min` : d.status} color={STATUS_COLOR[d.status]} />
  </Card>
);

function Weekly({ child }: any) {
  const { data, reload } = useFetch<any>(`/parent/children/${child.id}/weekly-summary`);
  if (!data) return <Loading />;
  const list = (items: any[], empty: string) => (items.length ? items.map((h) => <Card key={h.id}><Title>{h.title}</Title><Sub>{h.description}</Sub></Card>) : <Sub>{empty}</Sub>);
  return (
    <Page onRefresh={reload}>
      <Sub>Week of {day(data.weekStart)} – {day(data.weekEnd)}</Sub>
      <Heading>Attendance</Heading>
      <AttendanceStats s={data.attendance.summary} />
      <Heading>Classwork</Heading>{list(data.classwork, 'No classwork this week')}
      <Heading>Homework</Heading>{list(data.homework, 'No homework this week')}
      <Heading>Activities</Heading>
      <Sub>{data.activities.length ? data.activities.join(', ') : 'None tagged'} · {data.mediaCount} photo/video(s)</Sub>
      {data.teacherRemarks ? <><Heading>Teacher’s remarks</Heading><Card><Sub>{data.teacherRemarks}</Sub></Card></> : null}
      {data.feesDue.length ? <><Heading>Fees due</Heading>{data.feesDue.map((f: any, i: number) => <Card key={i}><Title>{f.name}: {money(f.due)}</Title><Sub>by {day(f.dueDate)}</Sub></Card>)}</> : null}
    </Page>
  );
}

// Month report needs the object response, so it is rendered separately from the generic list.
function AttendanceReport({ child }: any) {
  const [m, setM] = useState(() => new Date().toISOString().slice(0, 7));
  const { data, reload } = useFetch<any>(`/parent/children/${child.id}/attendance-report?month=${m}`);
  const shift = (n: number) => { const [y, mo] = m.split('-').map(Number); setM(new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7)); };
  return (
    <Page onRefresh={reload}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Chip label="◀ Prev" onPress={() => shift(-1)} /><Heading>{m}</Heading><Chip label="Next ▶" onPress={() => shift(1)} />
      </View>
      {!data ? <Loading /> : (
        <>
          <AttendanceStats s={data.summary} />
          {data.days.map((d: any) => <DayRow key={d.id} d={d} />)}
          {!data.days.length ? <Sub>No records this month</Sub> : null}
        </>
      )}
    </Page>
  );
}

function Performance({ child }: any) {
  const { data, reload } = useFetch<any>(`/parent/children/${child.id}/performance`);
  if (!data) return <Loading />;
  if (!data.reportCount) return <Page><Sub>No progress reports yet</Sub></Page>;
  return (
    <Page onRefresh={reload}>
      <Heading>Skills (out of 5)</Heading>
      {data.skills.map((k: any) => (
        <Card key={k.skill}>
          <Title>{k.skill[0].toUpperCase() + k.skill.slice(1)}</Title>
          <View style={{ height: 10, backgroundColor: '#f0e6dd', borderRadius: 5, marginVertical: 6 }}>
            <View style={{ height: 10, borderRadius: 5, width: `${((k.latest ?? 0) / 5) * 100}%`, backgroundColor: colors.primary }} />
          </View>
          <Sub>Latest {k.latest ?? '-'} · Average {k.average ?? '-'}{k.change ? ` · ${k.change > 0 ? '▲' : '▼'} ${Math.abs(k.change)} since last report` : ''}</Sub>
        </Card>
      ))}
      {data.latestRemarks ? <><Heading>Latest remarks</Heading><Card><Sub>{data.latestRemarks}</Sub></Card></> : null}
    </Page>
  );
}

function Photos({ child }: any) {
  const { data, reload } = useFetch<any[]>(`/parent/children/${child.id}/media`);
  return <Page onRefresh={reload}>{data ? <MediaGrid items={data} /> : <Loading />}</Page>;
}

const SECTIONS = ['Weekly', 'Attendance', 'Performance', 'Reports', 'Homework', 'Photos', 'Medical', 'Fees'];
function Child({ route }: any) {
  const child = route.params.child;
  const [tab, setTab] = useState('Weekly');
  const p = `/parent/children/${child.id}`;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: 16, paddingBottom: 0 }}>
        <Title>{child.name}</Title>
        <Sub>{child.batch.class.name} – {child.batch.name} · Teacher {child.batch.teacher?.name ?? '-'}</Sub>
      </View>
      <Segmented tabs={SECTIONS} value={tab} onChange={setTab} />
      {tab === 'Weekly' && <Weekly child={child} />}
      {tab === 'Attendance' && <AttendanceReport child={child} />}
      {tab === 'Performance' && <Performance child={child} />}
      {tab === 'Photos' && <Photos child={child} />}
      {tab === 'Reports' && (
        <ListScreen<any> key="r" path={`${p}/reports`} empty="No reports yet" render={(r) => (
          <Card><Title>{r.term}</Title>
            <Sub>Language {r.language ?? '-'} · Numeracy {r.numeracy ?? '-'} · Social {r.social ?? '-'} · Motor {r.motor ?? '-'} · Creativity {r.creativity ?? '-'}</Sub>
            {r.remarks ? <Sub>{r.remarks}</Sub> : null}<Sub>{day(r.createdAt)}</Sub></Card>
        )} />
      )}
      {tab === 'Homework' && (
        <ListScreen<any> key="h" path={`${p}/homework`} empty="Nothing posted yet" render={(h) => (
          <Card><Title>{h.title}</Title><Sub>{h.description}</Sub><Sub>{day(h.createdAt)}{h.dueDate ? ` · due ${day(h.dueDate)}` : ''}</Sub>
            <Badge text={h.kind} color={h.kind === 'HOMEWORK' ? colors.primary : colors.ok} /></Card>
        )} />
      )}
      {tab === 'Medical' && (
        <ListScreen<any> key="m" path={`${p}/medical`} empty="No medical history" render={(m) => (
          <Card><Title>{m.title}</Title><Sub>{m.type} · {day(m.date)}{m.notes ? ` · ${m.notes}` : ''}</Sub></Card>
        )} />
      )}
      {tab === 'Fees' && (
        <ListScreen<any> key="f" path={`${p}/invoices`} empty="No fees yet" render={(i) => (
          <Card><Title>{i.feeStructure.name} · {i.period}</Title>
            <Sub>{money(i.amount)}{i.status !== 'PAID' ? ` · ${money(i.amount - i.paidAmount)} due ${day(i.dueDate)}` : ''}</Sub>
            <Badge text={i.status} color={i.status === 'PAID' ? colors.ok : colors.warn} /></Card>
        )} />
      )}
    </View>
  );
}

function Children({ navigation }: any) {
  return (
    <ListScreen<any> path="/parent/children" empty="No children linked to your account"
      render={(c) => (
        <Card onPress={() => navigation.navigate('Child', { child: c })}>
          <Title>{c.name}</Title><Sub>{c.batch.class.name} – {c.batch.name} · {c.admissionNo}</Sub>
        </Card>
      )} />
  );
}
const ChildrenStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="Kids" component={Children} options={{ title: 'My children' }} />
    <Stack.Screen name="Child" component={Child} options={({ route }: any) => ({ title: route.params.child.name })} />
  </Stack.Navigator>
);

function Pickups({ navigation }: any) {
  return (
    <ListScreen<any> path="/parent/pickup-requests" empty="No requests yet"
      header={<Button label="+ Someone else will pick up / drop" onPress={() => navigation.navigate('NewPickup')} />}
      render={(r, reload) => (
        <Card>
          <Title>{r.student.name} · {r.type}</Title>
          <Sub>{r.personName} ({r.relation}) · {r.personPhone}</Sub><Sub>{day(r.date)}</Sub>
          <Badge text={r.status} color={STATUS_COLOR[r.status]} />
          {r.status === 'APPROVED' ? (
            <>
              <Sub>Give this code to {r.personName}. The teacher will ask for it:</Sub>
              <Text style={{ fontSize: 32, fontWeight: '800', letterSpacing: 6, color: colors.primary }}>{r.code}</Text>
            </>
          ) : null}
          {r.status === 'REJECTED' && r.decisionNote ? <Sub>{r.decisionNote}</Sub> : null}
          {r.status === 'PENDING' || r.status === 'APPROVED' ? (
            <Button label="Cancel request" secondary danger onPress={async () => { try { await api('POST', `/parent/pickup-requests/${r.id}/cancel`, {}); reload(); } catch (e: any) { Alert.alert('Error', e.message); } }} />
          ) : null}
        </Card>
      )} />
  );
}

function NewPickup({ navigation }: any) {
  const { data: kids } = useFetch<any[]>('/parent/children');
  if (!kids) return <Loading />;
  return (
    <FormScreen
      intro="The principal must approve this first. Once approved you get a 4-digit code to give to the person."
      submitLabel="Send request"
      fields={[
        { key: 'child', label: 'Child', kind: 'select', options: kids.map((k) => ({ value: k.id, label: k.name })) },
        { key: 'type', label: 'For', kind: 'select', options: [{ value: 'PICKUP', label: 'Pick-up' }, { value: 'DROP', label: 'Drop' }, { value: 'BOTH', label: 'Both' }] },
        { key: 'date', label: 'Date', kind: 'date' },
        { key: 'personName', label: 'Person’s name' }, { key: 'personPhone', label: 'Person’s phone', kind: 'phone' },
        { key: 'relation', label: 'Relation to child', placeholder: 'Uncle, Neighbour...' }, { key: 'reason', label: 'Reason', required: false },
      ]}
      submit={({ child, ...body }) => api('POST', `/parent/children/${child}/pickup-requests`, body)}
      onDone={() => { Alert.alert('Request sent', 'You will be notified when it is approved.'); navigation.goBack(); }} />
  );
}
const PickupStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="PickupList" component={Pickups} options={{ title: 'Pick-up & drop' }} />
    <Stack.Screen name="NewPickup" component={NewPickup} options={{ title: 'New request' }} />
  </Stack.Navigator>
);

const Events = () => (
  <ListScreen<any> path="/parent/events" empty="No upcoming events"
    render={(e) => <Card><Title>{e.title}</Title><Sub>{day(e.date)}{e.description ? ` · ${e.description}` : ''}</Sub></Card>} />
);

const icons: Record<string, string> = { Children: '👧', Pickup: '🚸', Events: '🎉', Alerts: '🔔', Me: '👤' };
export function ParentApp() {
  return (
    <Tabs.Navigator screenOptions={({ route }) => ({ tabBarActiveTintColor: colors.primary, tabBarIcon: () => <Title>{icons[route.name]}</Title> })}>
      <Tabs.Screen name="Children" component={ChildrenStack} options={{ headerShown: false }} />
      <Tabs.Screen name="Pickup" component={PickupStack} options={{ headerShown: false }} />
      <Tabs.Screen name="Events" component={Events} />
      <Tabs.Screen name="Alerts" component={NotificationsScreen} />
      <Tabs.Screen name="Me" component={ProfileScreen} />
    </Tabs.Navigator>
  );
}

