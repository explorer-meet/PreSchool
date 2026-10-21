import React from 'react';
import { Alert } from 'react-native';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Button, Card, FormScreen, ListScreen, Page, Sub, Title, colors, day, useFetch } from '../ui';
import { NotificationsScreen, ProfileScreen } from './common';
import { FormDef, Stack, batchLabel, batchOpt, classOpt, formScreens } from './shared';

const audienceFields = [
  { key: 'audience', label: 'Send to', kind: 'select' as const, options: [{ value: 'SCHOOL', label: 'Whole school' }, { value: 'CLASS', label: 'One class' }, { value: 'BATCH', label: 'One batch' }] },
  { key: 'classId', label: 'Class (if "One class")', required: false, ...classOpt },
  { key: 'batchId', label: 'Batch (if "One batch")', required: false, ...batchOpt },
];

const forms: Record<string, FormDef> = {
  AddScheduled: {
    title: 'Schedule notification', post: '/principal/notifications',
    intro: 'Repeats automatically: "Every month" sends on the chosen day of each month; "One time" sends on a date.',
    fields: [
      { key: 'title', label: 'Title' }, { key: 'body', label: 'Message', kind: 'multiline' },
      { key: 'kind', label: 'Repeat', kind: 'select', options: [{ value: 'MONTHLY', label: 'Every month' }, { value: 'ONCE', label: 'One time' }] },
      { key: 'dayOfMonth', label: 'Day of month (1-31, for "Every month")', kind: 'number', required: false },
      { key: 'date', label: 'Date (for "One time")', kind: 'date', required: false },
      { key: 'sendHour', label: 'Send at hour (0-23, default 9)', kind: 'number', required: false },
      ...audienceFields,
    ],
  },
  Broadcast: {
    title: 'Send notification now', post: '/principal/broadcast',
    fields: [{ key: 'title', label: 'Title' }, { key: 'body', label: 'Message', kind: 'multiline' }, ...audienceFields],
    after: (r) => Alert.alert('Sent', `Delivered to ${r.recipients} parent(s).`),
  },
  AddEvent: {
    title: 'Add event', post: '/principal/events', intro: 'Parents are notified now and reminded the day before.',
    fields: [
      { key: 'title', label: 'Title' }, { key: 'date', label: 'Date', kind: 'date' },
      { key: 'description', label: 'Description', kind: 'multiline', required: false },
      { key: 'batchId', label: 'Batch (blank = whole school)', required: false, ...batchOpt },
    ],
  },
};

function Menu({ navigation }: any) {
  const { logout } = useAuth();
  const items: [string, string][] = [
    ['🚸 Pick-up requests', 'Pickups'], ['📢 Scheduled notifications', 'Scheduled'], ['✉️ Send notification now', 'Broadcast'],
    ['🎉 Events', 'Events'], ['🔔 My alerts', 'Alerts'], ['⚙️ Fee reminder settings', 'Settings'],
  ];
  return (
    <Page>
      {items.map(([label, screen]) => <Card key={screen} onPress={() => navigation.navigate(screen)}><Title>{label}</Title></Card>)}
      <Card onPress={() => navigation.navigate('Me')}><Title>👤 Profile</Title></Card>
      <Button label="Sign out" secondary onPress={logout} />
    </Page>
  );
}

const SCHEDULE_AUD: Record<string, string> = { SCHOOL: 'Whole school', CLASS: 'Class', BATCH: 'Batch' };
function Scheduled({ navigation }: any) {
  return (
    <ListScreen<any> path="/principal/notifications" empty="No scheduled notifications"
      header={<Button label="+ Schedule notification" onPress={() => navigation.navigate('AddScheduled')} />}
      render={(n, reload) => (
        <Card onPress={() => Alert.alert(n.title, undefined, [
          { text: 'Close', style: 'cancel' },
          { text: n.active ? 'Pause' : 'Resume', onPress: async () => { await api('PATCH', `/principal/notifications/${n.id}`, { active: !n.active }); reload(); } },
          { text: 'Delete', style: 'destructive', onPress: async () => { await api('DELETE', `/principal/notifications/${n.id}`); reload(); } },
        ])}>
          <Title>{n.title}</Title><Sub>{n.body}</Sub>
          <Sub>{n.kind === 'MONTHLY' ? `Every month on day ${n.dayOfMonth}` : `Once on ${day(n.date)}`} at {String(n.sendHour).padStart(2, '0')}:00 · {SCHEDULE_AUD[n.audience]}</Sub>
          <Badge text={n.active ? 'ACTIVE' : 'PAUSED'} color={n.active ? colors.ok : colors.muted} />
        </Card>
      )} />
  );
}

function Events({ navigation }: any) {
  return (
    <ListScreen<any> path="/principal/events" empty="No events"
      header={<Button label="+ Add event" onPress={() => navigation.navigate('AddEvent')} />}
      render={(e) => <Card><Title>{e.title}</Title><Sub>{day(e.date)} · {e.batch ? batchLabel(e.batch) : 'Whole school'}</Sub></Card>} />
  );
}

const STATUS_COLOR: Record<string, string> = { PENDING: colors.warn, APPROVED: colors.ok, COMPLETED: colors.ok, REJECTED: colors.bad, CANCELLED: colors.muted };
function Pickups() {
  const decide = (id: string, approve: boolean, reload: () => void) => async () => {
    try { await api('POST', `/principal/pickup-requests/${id}/decide`, { approve }); reload(); } catch (e: any) { Alert.alert('Error', e.message); }
  };
  return (
    <ListScreen<any> path="/principal/pickup-requests" empty="No pick-up requests"
      render={(r, reload) => (
        <Card>
          <Title>{r.student.name} · {r.type}</Title>
          <Sub>{batchLabel(r.student.batch)}</Sub>
          <Sub>{r.personName} ({r.relation}) · {r.personPhone}</Sub>
          <Sub>{day(r.date)}{r.reason ? ` · ${r.reason}` : ''}</Sub>
          <Badge text={r.status} color={STATUS_COLOR[r.status]} />
          {r.status === 'PENDING' ? (
            <>
              <Button label="Approve" onPress={decide(r.id, true, reload)} />
              <Button label="Reject" secondary danger onPress={decide(r.id, false, reload)} />
            </>
          ) : null}
        </Card>
      )} />
  );
}

function Settings({ navigation }: any) {
  const { data } = useFetch<any>('/principal/settings');
  if (!data) return null;
  return (
    <FormScreen
      intro={`Fee reminders are sent automatically every morning. Currently: ${data.feeReminderDays} day(s) before the due date, then every 3 days until paid.`}
      fields={[{ key: 'feeReminderDays', label: 'Start reminders (days before due date)', kind: 'number' }]}
      submit={(b) => api('PATCH', '/principal/settings', b)}
      onDone={() => { Alert.alert('Saved'); navigation.goBack(); }} />
  );
}

export function MoreStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Menu" component={Menu} options={{ title: 'More' }} />
      <Stack.Screen name="Pickups" component={Pickups} options={{ title: 'Pick-up requests' }} />
      <Stack.Screen name="Scheduled" component={Scheduled} options={{ title: 'Scheduled notifications' }} />
      <Stack.Screen name="Events" component={Events} />
      <Stack.Screen name="Alerts" component={NotificationsScreen} options={{ title: 'My alerts' }} />
      <Stack.Screen name="Settings" component={Settings} options={{ title: 'Fee reminders' }} />
      <Stack.Screen name="Me" component={ProfileScreen} options={{ title: 'Profile' }} />
      {formScreens(forms)}
    </Stack.Navigator>
  );
}
