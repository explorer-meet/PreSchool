import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/auth';
import { ChangePasswordScreen, LoginScreen, ProfileScreen, RegisterSchoolScreen, SuperAdminHome } from './src/screens/common';
import { PrincipalApp } from './src/screens/principal';
import { TeacherApp } from './src/screens/teacher';
import { ParentApp } from './src/screens/parent';

const Stack = createNativeStackNavigator();

function Root() {
  const { session, loading } = useAuth();
  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;

  if (!session) {
    return (
      <Stack.Navigator>
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
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
        <Stack.Navigator>
          <Stack.Screen name="Schools" component={SuperAdminHome} options={{ title: 'Pending schools' }} />
          <Stack.Screen name="Me" component={ProfileScreen} />
        </Stack.Navigator>
      );
    case 'PRINCIPAL': return <PrincipalApp />;
    case 'TEACHER': return <TeacherApp />;
    case 'PARENT': return <ParentApp />;
    default: return <Stack.Navigator><Stack.Screen name="Me" component={ProfileScreen} /></Stack.Navigator>;
  }
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer><Root /></NavigationContainer>
      <StatusBar style="dark" />
    </AuthProvider>
  );
}
