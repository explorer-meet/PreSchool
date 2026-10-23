import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export type PopupVariant = 'success' | 'danger' | 'warning' | 'info';

const THEME: Record<PopupVariant, { color: string; soft: string; icon: string }> = {
  success: { color: '#2e9e6b', soft: '#e8f6ef', icon: '✓' },
  danger: { color: '#dc6258', soft: '#fdecea', icon: '✕' },
  warning: { color: '#d99b12', soft: '#fff5d9', icon: '!' },
  info: { color: '#4a90d9', soft: '#e7f2fc', icon: 'i' },
};

export interface PopupOptions {
  variant?: PopupVariant;
  title: string;
  subtitle?: string;
  emoji?: string; // replaces the default glyph, e.g. 📣 for a sent notification
  duration?: number;
  onHidden?: () => void;
}

interface PopupApi {
  show(options: PopupOptions): void;
  success(title: string, subtitle?: string, extra?: Partial<PopupOptions>): void;
  error(message: string, title?: string): void;
  warn(title: string, subtitle?: string): void;
  confirm(title: string, subtitle: string, confirmLabel?: string, danger?: boolean): Promise<boolean>;
  credentials(title: string, login: string, password: string): void;
}

interface Confirmation { title: string; subtitle: string; confirmLabel: string; danger: boolean }
interface Credentials { title: string; login: string; password: string }
const PopupContext = createContext<PopupApi>({ show() {}, success() {}, error() {}, warn() {}, confirm: async () => false, credentials() {} });
export const usePopup = () => useContext(PopupContext);

// Same API for code outside React components (helpers, event handlers); wired up by PopupProvider.
let host: PopupApi | null = null;
export const popup: PopupApi = {
  show: (o) => host?.show(o),
  success: (t, s, e) => host?.success(t, s, e),
  error: (m, t) => host?.error(m, t),
  warn: (t, s) => host?.warn(t, s),
  confirm: (t, s, l, d) => host?.confirm(t, s, l, d) ?? Promise.resolve(false),
  credentials: (t, l, p) => host?.credentials(t, l, p),
};

// One animated pop-up host for the whole app; any screen can call usePopup().success(...) etc.
export function PopupProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<(PopupOptions & { id: number }) | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const confirmationResolver = useRef<((confirmed: boolean) => void) | null>(null);
  const finishConfirmation = (confirmed: boolean) => {
    const resolve = confirmationResolver.current;
    confirmationResolver.current = null;
    setConfirmation(null);
    resolve?.(confirmed);
  };
  const [api] = useState<PopupApi>(() => {
    let counter = 0;
    const show = (o: PopupOptions) => setCurrent({ ...o, id: ++counter });
    return {
      show,
      success: (title, subtitle, extra) => show({ variant: 'success', title, subtitle, ...extra }),
      error: (message, title = 'Something went wrong') => show({ variant: 'danger', title, subtitle: message, duration: 3800 }),
      warn: (title, subtitle) => show({ variant: 'warning', title, subtitle, duration: 3400 }),
      confirm: (title, subtitle, confirmLabel = 'Continue', danger = false) => new Promise((resolve) => {
        confirmationResolver.current?.(false);
        confirmationResolver.current = resolve;
        setConfirmation({ title, subtitle, confirmLabel, danger });
      }),
      credentials: (title, login, password) => setCredentials({ title, login, password }),
    };
  });
  useEffect(() => {
    host = api;
    return () => { if (host === api) host = null; confirmationResolver.current?.(false); confirmationResolver.current = null; };
  }, [api]);

  return (
    <PopupContext.Provider value={api}>
      {children}
      <ResultPopup
        key={current?.id ?? 0}
        visible={!!current}
        variant={current?.variant ?? 'success'}
        title={current?.title ?? ''}
        subtitle={current?.subtitle}
        emoji={current?.emoji}
        duration={current?.duration}
        onHide={() => {
          const done = current?.onHidden;
          setCurrent(null);
          done?.();
        }}
      />
      <Modal
        visible={!!confirmation}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => finishConfirmation(false)}
      >
        <SafeAreaView style={styles.confirmBackdrop}>
          <ScrollView style={styles.confirmCard} contentContainerStyle={styles.confirmContent}>
            <View style={[styles.confirmIcon, { backgroundColor: confirmation?.danger ? '#fdecea' : '#e8f6ef' }]}>
              <Text style={[styles.confirmGlyph, { color: confirmation?.danger ? '#dc6258' : '#2e9e6b' }]}>{confirmation?.danger ? '!' : '?'}</Text>
            </View>
            <Text style={styles.confirmTitle}>{confirmation?.title}</Text>
            <Text style={styles.confirmSubtitle}>{confirmation?.subtitle}</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity accessibilityRole="button" style={styles.cancelButton} onPress={() => finishConfirmation(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={[styles.confirmButton, confirmation?.danger && styles.dangerButton]} onPress={() => finishConfirmation(true)}>
                <Text style={styles.confirmText}>{confirmation?.confirmLabel ?? 'Continue'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <Modal visible={!!credentials} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setCredentials(null)}>
      <SafeAreaView style={styles.confirmBackdrop}>
        <ScrollView style={styles.confirmCard} contentContainerStyle={styles.confirmContent}>
          <View style={[styles.confirmIcon, { backgroundColor: '#e7f2fc' }]}>
            <Text style={[styles.confirmGlyph, { color: '#4a90d9' }]}>🔐</Text>
          </View>
          <Text style={styles.confirmTitle}>{credentials?.title}</Text>
          <Text style={styles.confirmSubtitle}>Share these temporary credentials securely. The password is shown only until you close this window.</Text>
          <Text selectable style={[styles.confirmTitle, { marginTop: 14 }]}>{credentials?.login}</Text>
          <Text selectable style={[styles.confirmTitle, { marginTop: 8 }]}>{credentials?.password}</Text>
          <TouchableOpacity accessibilityRole="button" style={[styles.confirmButton, { alignSelf: 'stretch', marginTop: 20, flexBasis: 'auto', flexGrow: 0 }]} onPress={() => setCredentials(null)}>
            <Text style={styles.confirmText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
      </Modal>
    </PopupContext.Provider>
  );
}

/**
 * Animated result card: slides up from the bottom to the centre, springs the icon in,
 * then dismisses itself after `duration` ms and calls onHide.
 */
export function ResultPopup({ visible, variant, title, subtitle, emoji, duration = 2800, onHide }: {
  visible: boolean; variant: PopupVariant; title: string; subtitle?: string; emoji?: string; duration?: number; onHide: () => void;
}) {
  const [slide] = useState(() => new Animated.Value(0));
  const [icon] = useState(() => new Animated.Value(0));
  const [progress] = useState(() => new Animated.Value(0));
  const theme = THEME[variant];

  useEffect(() => {
    if (!visible) return;
    slide.setValue(0);
    icon.setValue(0);
    progress.setValue(0);
    const animation = Animated.parallel([
      Animated.timing(slide, { toValue: 1, duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(220),
        Animated.spring(icon, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
      ]),
      Animated.timing(progress, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: false }),
    ]);
    animation.start();
    const exit = Animated.timing(slide, { toValue: 2, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true });
    const timer = setTimeout(() => {
      exit.start(({ finished }) => { if (finished) onHide(); });
    }, duration);
    return () => { clearTimeout(timer); animation.stop(); exit.stop(); };
    // onHide is intentionally omitted so parent re-renders do not restart the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const translateY = slide.interpolate({ inputRange: [0, 1, 2], outputRange: [420, 0, 60] });
  const opacity = slide.interpolate({ inputRange: [0, 0.6, 1, 2], outputRange: [0, 1, 1, 0] });
  const scale = slide.interpolate({ inputRange: [0, 1, 2], outputRange: [0.92, 1, 0.94] });
  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['100%', '0%'] });

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onHide}>
      <Animated.View style={[styles.backdrop, { opacity: slide.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] }) }]}>
        <SafeAreaView style={{ width: '100%', maxWidth: 400, maxHeight: '100%', alignItems: 'center' }}>
        <ScrollView style={{ width: '100%', flexGrow: 0 }} contentContainerStyle={{ alignItems: 'center' }}>
        <Animated.View
          accessibilityLiveRegion="polite"
          style={[styles.card, { opacity, transform: [{ translateY }, { scale }] }]}
        >
          <Animated.View style={[styles.halo, { backgroundColor: theme.soft, transform: [{ scale: icon }] }]}>
            <View style={[styles.circle, { backgroundColor: theme.color }]}>
              <Text style={emoji ? styles.emoji : styles.glyph}>{emoji ?? theme.icon}</Text>
            </View>
          </Animated.View>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dismiss message" style={styles.dismiss} onPress={onHide}><Text style={{ color: theme.color, fontWeight: '700' }}>Dismiss</Text></TouchableOpacity>
          <View style={styles.track}>
            <Animated.View style={[styles.bar, { backgroundColor: theme.color, width }]} />
          </View>
        </Animated.View>
        </ScrollView>
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#1e2b2499', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: {
    width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 26, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 20,
    alignItems: 'center', elevation: 12, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
  },
  halo: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  circle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  glyph: { color: '#fff', fontSize: 32, fontWeight: '800', lineHeight: 38 },
  emoji: { fontSize: 30, lineHeight: 38 },
  title: { color: '#252b33', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: '#7c8490', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  track: { alignSelf: 'stretch', height: 4, borderRadius: 2, backgroundColor: '#f1f0ed', marginTop: 20, overflow: 'hidden' },
  bar: { height: 4, borderRadius: 2 },
  dismiss: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 20, marginTop: 10 },
  confirmBackdrop: { flex: 1, backgroundColor: '#1e2b2499', alignItems: 'center', justifyContent: 'center', padding: 24 },
  confirmCard: { width: '100%', maxWidth: 400, maxHeight: '100%', flexGrow: 0, backgroundColor: '#fff', borderRadius: 24 },
  confirmContent: { padding: 24, alignItems: 'center' },
  confirmIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  confirmGlyph: { fontSize: 26, fontWeight: '800' },
  confirmTitle: { color: '#252b33', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  confirmSubtitle: { color: '#7c8490', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  confirmActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignSelf: 'stretch', marginTop: 22 },
  cancelButton: { flexGrow: 1, flexBasis: 120, minHeight: 48, padding: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f3' },
  confirmButton: { flexGrow: 1, flexBasis: 120, minHeight: 48, padding: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2e9e6b' },
  dangerButton: { backgroundColor: '#dc6258' },
  cancelText: { color: '#252b33', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  confirmText: { color: '#fff', fontSize: 14, fontWeight: '700', textAlign: 'center' },
});
