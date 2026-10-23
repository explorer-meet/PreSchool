import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { api } from '../api';
import { popup } from '../ResultPopup';
import { FieldDef, FormScreen } from '../ui';
export const Stack = createNativeStackNavigator();

export const batchLabel = (b: any) => `${b.class.name} – ${b.name}`;
export const classOpt = { kind: 'select' as const, optionsPath: '/principal/classes' };
export const batchOpt = { kind: 'select' as const, optionsPath: '/principal/batches', optionLabel: batchLabel };

export function credsAlert(r: any, who: string) {
  if (r.emailSent) popup.success('Login details sent!', `Emailed to ${r.login ?? r.parentLogin ?? who}.`, { emoji: '📧' });
  else if (r.temporaryPassword) {
    popup.credentials(`Share login details for ${who}`, r.login ?? r.parentLogin ?? '', r.temporaryPassword);
  } else popup.success('Saved');
}

export interface FormDef {
  title: string; fields: FieldDef[]; post: string; editPath?: string; editFields?: FieldDef[];
  transform?: (b: any) => any; after?: (r: any) => void; intro?: string; initialValues?: Record<string, string>; submitLabel?: string;
}
// Registers form screens by name so list screens can navigate to them with serialisable params only.
export const formScreens = (defs: Record<string, FormDef>) =>
  Object.entries(defs).map(([name, d]) => (
    <Stack.Screen key={name} name={name} options={{ title: d.title }}>
      {({ navigation, route }: any) => {
        const item = d.editPath ? route.params?.item : undefined;
        const fields = item && d.editPath ? (d.editFields ?? d.fields) : d.fields;
        const initialValues = item ? Object.fromEntries(fields.map((f) => {
          const value = item[f.key];
          const formatted = value == null ? '' : f.kind === 'money' ? String(value / 100) : String(value);
          return [f.key, f.kind === 'date' ? formatted.slice(0, 10) : formatted];
        })) : d.initialValues;
        return (
          <FormScreen key={item?.id ?? 'new'} fields={fields} initialValues={initialValues} intro={d.intro} transform={d.transform}
            submitLabel={item ? 'Save changes' : d.submitLabel ?? `Add ${d.title.toLowerCase()}`}
            submit={(b) => item && d.editPath ? api('PATCH', `${d.editPath}/${item.id}`, b) : api('POST', d.post, b)}
            onDone={(r) => { if (d.after) d.after(r); else popup.success(`${d.title} ${item ? 'updated' : 'added'}`); navigation.goBack(); }} />
        );
      }}
    </Stack.Screen>
  ));
