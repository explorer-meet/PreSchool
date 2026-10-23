import React, { useEffect, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Sub, colors } from './ui';
import { popup } from './ResultPopup';

export interface RegistrationResult {
  name: string;
  detail: string;
  login: string;
  emailSent: boolean;
  existingAccount?: boolean;
  temporaryPassword?: string;
}

export function RegistrationSuccess({ result, kind, onAnother, onDone }: {
  result: RegistrationResult; kind: 'student' | 'staff'; onAnother: () => void; onDone: () => void;
}) {
  const [entrance] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = Animated.spring(entrance, { toValue: 1, friction: 6, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [entrance]);
  const status = result.emailSent ? 'Sent' : result.existingAccount ? 'Linked' : 'Not sent';
  const subtitle = result.emailSent
    ? `Login details were emailed to ${kind === 'student' ? 'the parent' : 'the staff member'}.`
    : result.existingAccount ? 'Linked to the existing parent account. Their login is unchanged.'
      : 'Saved successfully. Email was not delivered; share the login details securely.';
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.page}>
      <Animated.View style={{ opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}>
        <View style={styles.hero}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.confetti}>
            {['#ffc747', '#a48bfa', '#ff766d', '#4b9ffd'].map((color, index) => <View key={color} style={[styles.dot, { backgroundColor: color, left: index % 2 ? '78%' : '18%', top: index < 2 ? 4 : 72, transform: [{ rotate: `${index * 25}deg` }] }]} />)}
          </View>
          <View style={styles.check}><Text style={styles.checkText}>✓</Text></View>
          <Text accessibilityRole="header" style={styles.title}>{result.name} is added</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <Card>
          <View style={styles.row}>
            <View style={styles.avatar}><Text style={styles.initials}>{result.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}><Text style={styles.name}>{result.name}</Text><Sub>{result.detail}</Sub></View>
          </View>
          <View style={styles.login}>
            <View style={{ flex: 1 }}><Sub>{kind === 'student' ? 'Parent login' : 'Staff login'}</Sub><Text selectable style={styles.name}>{result.login}</Text></View>
            <Text style={[styles.status, !result.emailSent && !result.existingAccount && { color: colors.warn }]}>{status}</Text>
          </View>
        </Card>
        {result.temporaryPassword ? <Button label="View temporary login details" secondary onPress={() => popup.credentials(`Login for ${result.name}`, result.login, result.temporaryPassword!)} /> : null}
        <Button label={kind === 'student' ? 'Add another child' : 'Add another teacher / staff'} onPress={onAnother} />
        <Button label="Done" secondary onPress={onDone} />
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 22, paddingBottom: 40, flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 620, alignSelf: 'center' },
  hero: { alignItems: 'center', paddingVertical: 30 },
  confetti: { position: 'absolute', top: 30, width: '100%', height: 110 },
  dot: { position: 'absolute', height: 9, width: 9, borderRadius: 3 },
  check: { height: 90, width: 90, borderRadius: 45, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 30 },
  checkText: { color: '#fff', fontSize: 58, fontWeight: '600' },
  title: { color: colors.text, fontSize: 25, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: colors.muted, lineHeight: 21, textAlign: 'center', marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { height: 44, width: 44, borderRadius: 22, backgroundColor: '#ff766d', alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#fff', fontWeight: '800' },
  name: { fontWeight: '700', color: colors.text },
  login: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, marginTop: 14, paddingTop: 12, gap: 10 },
  status: { color: colors.primary, fontSize: 12, fontWeight: '700' },
});
