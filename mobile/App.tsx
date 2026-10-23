import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth';
import { AdminAuditLogScreen, ChangePasswordScreen, ForgotPasswordScreen, LoginScreen, ProfileScreen, RegisterSchoolScreen, SuperAdminHome, SuperAdminSchools } from './src/screens/common';
import { PrincipalApp } from './src/screens/principal';
import { TeacherApp } from './src/screens/teacher';
import { ParentApp } from './src/screens/parent';
import { PopupProvider } from './src/ResultPopup';
import { colors } from './src/ui';

const Stack = createNativeStackNavigator();
const AdminTabs = createBottomTabNavigator();
const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: colors.card,
    text: colors.text,
    border: colors.border,
    notification: colors.bad,
  },
};

function Root() {
  const { session, loading } = useAuth();
  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;

  if (!session) {
    return (
      <Stack.Navigator>
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ headerShown: false }} />
        <Stack.Screen name="RegisterSchool" component={RegisterSchoolScreen} options={{ title: 'Register school' }} />
      </Stack.Navigator>
    );
  }
  if (session.mustChangePassword) {
    return <Stack.Navigator><Stack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: 'Set a new password' }} /></Stack.Navigator>;
  }
  switch (session.user.role) {
    case 'SUPER_ADMIN':
      return (
        <AdminTabs.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.muted,
            tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, paddingTop: 5 },
            tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
            tabBarIcon: ({ color }) => {
              const icons: Record<string, string> = { Requests: '☷', Schools: '♙', 'Audit log': '▤', Profile: '○' };
              return <Text style={{ color, fontSize: 20, lineHeight: 24 }}>{icons[route.name]}</Text>;
            },
          })}
        >
          <AdminTabs.Screen name="Requests" component={SuperAdminHome} />
          <AdminTabs.Screen name="Schools" component={SuperAdminSchools} />
          <AdminTabs.Screen name="Audit log" component={AdminAuditLogScreen} />
          <AdminTabs.Screen name="Profile" component={ProfileScreen} />
        </AdminTabs.Navigator>
      );
    case 'PRINCIPAL': return <PrincipalApp />;
    case 'TEACHER': return <TeacherApp />;
    case 'PARENT': return <ParentApp />;
    default: return <Stack.Navigator><Stack.Screen name="Me" component={ProfileScreen} /></Stack.Navigator>;
  }
}

export default function App() {
  return (
    <SafeAreaProvider><AuthProvider>
      <PopupProvider>
        <NavigationContainer theme={navigationTheme}><Root /></NavigationContainer>
      </PopupProvider>
      <StatusBar style="dark" />
    </AuthProvider></SafeAreaProvider>
  );
}
