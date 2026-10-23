import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

export type TinyMood = 'idle' | 'cover' | 'success';

const CONFETTI = ['#4a90d9', '#e8604c', '#f5b72b', '#2e9e6b', '#8a78d4', '#df7168', '#4a90d9', '#f5b72b'];

/**
 * "Tiny", the login mascot: waves while idle, covers his eyes while the password is typed,
 * and cheers with confetti on success. Built from plain Views so no extra dependency is needed.
 */
export function Tiny({ mood }: { mood: TinyMood }) {
  const [cover] = useState(() => new Animated.Value(0));
  const [cheer] = useState(() => new Animated.Value(0));
  const [wave] = useState(() => new Animated.Value(0));
  const [bob] = useState(() => new Animated.Value(0));
  const [burst] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [bob]);

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(wave, { toValue: 1, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(wave, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    if (mood === 'idle') loop.start(); else wave.setValue(0);
    return () => loop.stop();
  }, [mood, wave]);

  useEffect(() => {
    Animated.spring(cover, { toValue: mood === 'cover' ? 1 : 0, friction: 6, tension: 90, useNativeDriver: true }).start();
    Animated.spring(cheer, { toValue: mood === 'success' ? 1 : 0, friction: 5, tension: 80, useNativeDriver: true }).start();
    if (mood === 'success') {
      burst.setValue(0);
      Animated.timing(burst, { toValue: 1, duration: 1500, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [mood, cover, cheer, burst]);

  const bodyY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  const jump = cheer.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });

  // Each hand has an idle spot at the side, a covering spot over the eyes and a raised cheering spot.
  const hand = (side: -1 | 1) => {
    const x = Animated.add(
      cover.interpolate({ inputRange: [0, 1], outputRange: [0, -side * 40] }),
      cheer.interpolate({ inputRange: [0, 1], outputRange: [0, side * 6] }),
    );
    const y = Animated.add(cover.interpolate({ inputRange: [0, 1], outputRange: [0, -34] }), cheer.interpolate({ inputRange: [0, 1], outputRange: [0, -18] }));
    const rotate = Animated.add(
      wave.interpolate({ inputRange: [0, 1], outputRange: [side * 4, side * 22] }),
      cover.interpolate({ inputRange: [0, 1], outputRange: [0, -side * 8] }),
    ).interpolate({ inputRange: [-40, 40], outputRange: ['-40deg', '40deg'] });
    return { transform: [{ translateX: x }, { translateY: y }, { rotate }] };
  };

  const eyeScale = cover.interpolate({ inputRange: [0, 1], outputRange: [1, 0.1] });
  const mouthOpen = cheer.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });

  return (
    <View style={styles.stage} accessibilityLabel="Tiny the mascot">
      <View style={styles.glow} />
      <Animated.View style={[styles.figure, { transform: [{ translateY: Animated.add(bodyY, jump) }] }]}>
        <View style={styles.leafStem} />
        <View style={styles.leaf} />
        <View style={styles.body}>
          <View style={styles.eyes}>
            <Animated.View style={[styles.eye, { transform: [{ scaleY: eyeScale }] }]}><View style={styles.shine} /></Animated.View>
            <Animated.View style={[styles.eye, { transform: [{ scaleY: eyeScale }] }]}><View style={styles.shine} /></Animated.View>
          </View>
          <View style={styles.cheeks}>
            <View style={styles.cheek} /><View style={styles.cheek} />
          </View>
          <Animated.View style={[styles.mouth, { transform: [{ scaleX: mouthOpen }] }]} />
        </View>
        <Animated.View style={[styles.hand, styles.handLeft, hand(-1)]} />
        <Animated.View style={[styles.hand, styles.handRight, hand(1)]} />
      </Animated.View>

      {mood === 'success' ? (
        <>
          <Animated.View style={[styles.check, { transform: [{ scale: cheer }] }]}><Text style={styles.checkText}>✓</Text></Animated.View>
          {CONFETTI.map((color, i) => {
            const angle = (i / CONFETTI.length) * Math.PI * 2;
            const dx = Math.cos(angle) * (70 + (i % 3) * 14);
            const dy = Math.sin(angle) * (52 + (i % 2) * 18);
            return (
              <Animated.View
                key={i}
                style={[styles.confetti, {
                  backgroundColor: color,
                  opacity: burst.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 1, 1, 0] }),
                  transform: [
                    { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
                    { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, dy + 26] }) },
                    { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${180 + i * 50}deg`] }) },
                  ],
                }]}
              />
            );
          })}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { height: 150, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 140, height: 140, borderRadius: 70, backgroundColor: '#e3f4ea' },
  figure: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  leafStem: { position: 'absolute', top: 4, width: 4, height: 12, borderRadius: 2, backgroundColor: '#2e9e6b' },
  leaf: { position: 'absolute', top: 0, left: 54, width: 30, height: 16, borderRadius: 10, backgroundColor: '#2e9e6b', transform: [{ rotate: '-18deg' }] },
  body: { width: 96, height: 92, borderRadius: 46, backgroundColor: '#f8b83c', marginTop: 14, alignItems: 'center', justifyContent: 'center' },
  eyes: { flexDirection: 'row', gap: 26, marginTop: -4 },
  eye: { width: 11, height: 14, borderRadius: 6, backgroundColor: '#3b2a1c', alignItems: 'center' },
  shine: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff', marginTop: 2 },
  cheeks: { position: 'absolute', top: 46, flexDirection: 'row', gap: 52 },
  cheek: { width: 14, height: 9, borderRadius: 7, backgroundColor: '#f28a6a', opacity: 0.8 },
  mouth: { width: 12, height: 7, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: '#9a3b2a', marginTop: 8 },
  hand: { position: 'absolute', top: 66, width: 22, height: 34, borderRadius: 12, backgroundColor: '#fcd9b0', borderWidth: 2, borderColor: '#f2b985' },
  handLeft: { left: -2 },
  handRight: { right: -2 },
  check: { position: 'absolute', bottom: 12, right: '30%', width: 26, height: 26, borderRadius: 13, backgroundColor: '#2e9e6b', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  checkText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  confetti: { position: 'absolute', width: 9, height: 9, borderRadius: 2 },
});
