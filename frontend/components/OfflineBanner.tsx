/**
 * components/OfflineBanner.tsx
 *
 * Exporte deux composants :
 *  - OfflineBanner  : bannière globale (à placer dans _layout.tsx)
 *  - StaleBanner    : indicateur discret par écran quand les données sont stales
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetwork } from '../hooks/useNetwork';
import { Colors } from '../constants/Colors';

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

// ── ContentDeletedState ───────────────────────────────────────────────────────
/** État affiché quand un contenu (SpotYou, service) est supprimé ou inaccessible.
 *  Distincte de ErrorNoData : pas de bouton "Réessayer", pas d'icône réseau.
 */
interface ContentDeletedStateProps {
  onBack?: () => void;
  message?: string;
  testID?: string;
}

export function ContentDeletedState({ onBack, message, testID }: ContentDeletedStateProps) {
  return (
    <View style={cst.wrap} testID={testID || 'content-deleted-state'}>
      <Ionicons name="cube-outline" size={56} color="rgba(255,255,255,0.2)" />
      <Text style={cst.title}>Contenu indisponible</Text>
      <Text style={cst.sub}>
        {message || 'Ce contenu n\'est plus disponible.\nIl a peut-être été supprimé par son auteur.'}
      </Text>
      {onBack && (
        <TouchableOpacity style={cst.backBtn} onPress={onBack} testID="content-deleted-back-btn">
          <Ionicons name="chevron-back" size={15} color={Colors.foreground} />
          <Text style={cst.backBtnText}>Retour</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const Colors_local = { background: '#000000', foreground: '#FFFFFF', muted: '#8E8E93', primary: '#00BFA5' };

const cst = StyleSheet.create({
  wrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 14, padding: 40, backgroundColor: Colors.background,
  },
  title: { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.8)' },
  sub: {
    fontSize: 14, color: 'rgba(255,255,255,0.4)',
    textAlign: 'center', lineHeight: 22,
  },
  backBtn: {
    marginTop: 8,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20, paddingHorizontal: 22, paddingVertical: 11,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  backBtnText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
});

// ── ErrorNoData ───────────────────────────────────────────────────────────────

interface ErrorNoDataProps {
  onRetry: () => void;
  onBack?: () => void;
  message?: string;
  testID?: string;
}

export function ErrorNoData({ onRetry, onBack, message, testID }: ErrorNoDataProps) {
  return (
    <View style={est.wrap} testID={testID || 'error-no-data'}>
      <Ionicons name="wifi-outline" size={64} color="rgba(255,255,255,0.35)" />
      <Text style={est.title}>Pas de connexion</Text>
      <Text style={est.sub}>{message || 'Vérifiez votre réseau et réessayez.'}</Text>
      <TouchableOpacity style={est.btn} onPress={onRetry} testID="retry-btn">
        <Ionicons name="refresh-outline" size={15} color="#0D1117" />
        <Text style={est.btnText}>Réessayer</Text>
      </TouchableOpacity>
      {onBack && (
        <TouchableOpacity style={est.backBtn} onPress={onBack} testID="back-nav-btn">
          <Ionicons name="chevron-back" size={15} color="rgba(255,255,255,0.6)" />
          <Text style={est.backBtnText}>Retour</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const est = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 32,
  },
  title: { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  sub: { fontSize: 14, color: 'rgba(255,255,255,0.45)', textAlign: 'center', lineHeight: 20 },
  btn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1DBF73',
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  btnText: { fontSize: 14, fontWeight: '700', color: '#0D1117' },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  backBtnText: { fontSize: 14, color: 'rgba(255,255,255,0.6)' },
});
