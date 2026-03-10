/**
 * components/OfflineBanner.tsx
 *
 * Exporte deux composants :
 *  - OfflineBanner  : bannière globale (à placer dans _layout.tsx)
 *  - StaleBanner    : indicateur discret par écran quand les données sont stales
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetwork } from '../hooks/useNetwork';

// ── OfflineBanner ─────────────────────────────────────────────────────────────

export function OfflineBanner() {
  const { status, wasOffline } = useNetwork();
  const translateY = useRef(new Animated.Value(-52)).current;
  const isVisible = status === 'offline' || status === 'weak';

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: isVisible ? 0 : -52,
      useNativeDriver: true,
      tension: 60,
      friction: 10,
    }).start();
  }, [isVisible]);

  // Afficher aussi brièvement le "retour connexion" (wasOffline pendant 3s)
  if (!isVisible && !wasOffline) return null;

  const isWeak = status === 'weak';
  const isBack = !isVisible && wasOffline;

  const bgColor = isBack ? '#10B981' : isWeak ? '#F59E0B' : '#EF4444';
  const iconName: any = isBack ? 'wifi' : isWeak ? 'wifi' : 'wifi-outline';
  const label = isBack
    ? 'Connexion rétablie'
    : isWeak
    ? 'Connexion faible — données en cache'
    : 'Hors ligne — affichage depuis le cache';

  return (
    <Animated.View
      style={[bst.banner, { backgroundColor: bgColor, transform: [{ translateY }] }]}
      testID="offline-banner"
    >
      <Ionicons name={iconName} size={13} color="#fff" />
      <Text style={bst.text}>{label}</Text>
    </Animated.View>
  );
}

const bst = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: 0.1,
  },
});

// ── StaleBanner ───────────────────────────────────────────────────────────────

interface StaleBannerProps {
  staleMinutes: number | null;
  /** Optionnel : forcer l'affichage même si staleMinutes est null */
  forceShow?: boolean;
}

export function StaleBanner({ staleMinutes, forceShow }: StaleBannerProps) {
  if (staleMinutes === null && !forceShow) return null;

  let label: string;
  if (staleMinutes === null || staleMinutes < 1) {
    label = 'Données en cache récentes';
  } else if (staleMinutes < 60) {
    label = `Cache de il y a ${staleMinutes} min`;
  } else {
    label = `Cache de il y a ${Math.round(staleMinutes / 60)}h`;
  }

  return (
    <View style={sst.wrap} testID="stale-banner">
      <Ionicons name="time-outline" size={11} color="#F59E0B" />
      <Text style={sst.text}>{label}</Text>
    </View>
  );
}

const sst = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 5,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245,158,11,0.15)',
  },
  text: {
    fontSize: 11,
    color: '#F59E0B',
    fontWeight: '500',
  },
});

// ── ErrorNoData ───────────────────────────────────────────────────────────────

interface ErrorNoDataProps {
  onRetry: () => void;
  message?: string;
  testID?: string;
}

export function ErrorNoData({ onRetry, message, testID }: ErrorNoDataProps) {
  const { Pressable } = require('react-native');
  return (
    <View style={est.wrap} testID={testID || 'error-no-data'}>
      <Ionicons name="wifi-outline" size={52} color="rgba(255,255,255,0.2)" />
      <Text style={est.title}>Pas de connexion</Text>
      <Text style={est.sub}>{message || 'Vérifiez votre réseau et réessayez.'}</Text>
      <Pressable style={est.btn} onPress={onRetry} testID="retry-btn">
        <Ionicons name="refresh-outline" size={15} color="#0D1117" />
        <Text style={est.btnText}>Réessayer</Text>
      </Pressable>
    </View>
  );
}

const est = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  title: { fontSize: 17, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },
  sub: { fontSize: 14, color: 'rgba(255,255,255,0.4)', textAlign: 'center', lineHeight: 20 },
  btn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1DBF73',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  btnText: { fontSize: 14, fontWeight: '700', color: '#0D1117' },
});
