import React from 'react';
import { Alert } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { api } from '../api';
import { FieldDef, FormScreen } from '../ui';
export const Stack = createNativeStackNavigator();

export const batchLabel = (b: any) => `${b.class.name} – ${b.name}`;
export const classOpt = { kind: 'select' as const, optionsPath: '/principal/classes' };
export const batchOpt = { kind: 'select' as const, optionsPath: '/principal/batches', optionLabel: batchLabel };

export function credsAlert(r: any, who: string) {
  Alert.alert(
    'Done',
    r.emailSent ? `Login details were emailed to ${r.login ?? r.parentLogin ?? who}.` : r.temporaryPassword ? `Email is not configured.\nLogin: ${r.login ?? r.parentLogin ?? ''}\nTemporary password: ${r.temporaryPassword}\n\nShare securely.` : 'Saved.',
  );
}

export interface FormDef { title: string; fields: FieldDef[]; post: string; transform?: (b: any) => any; after?: (r: any) => void; intro?: string }
// Registers form screens by name so list screens can navigate to them with serialisable params only.
export const formScreens = (defs: Record<string, FormDef>) =>
  Object.entries(defs).map(([name, d]) => (
    <Stack.Screen key={name} name={name} options={{ title: d.title }}>
      {({ navigation }: any) => (
        <FormScreen fields={d.fields} intro={d.intro} transform={d.transform} submit={(b) => api('POST', d.post, b)} onDone={(r) => { d.after?.(r); navigation.goBack(); }} />
      )}
    </Stack.Screen>
  ));


