import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../constants/Colors';

// ── Constants ──
export const COVER_H = 220;
export const COVER_IMG_H = 380;
export const MAX_OFFSET_PX = COVER_IMG_H - COVER_H;

export const TEAL_DIM = 'rgba(0,191,165,0.12)';
export const TEAL_BORDER = 'rgba(0,191,165,0.3)';

// ── Badge logic ──
export type Badge = { label: string; color: string; bg: string; icon: string };
export function computeBadge(avg: number | null, count: number): Badge | null {
  if (!avg || count < 3 || avg < 3.5) return null;
  if (avg >= 4.8 && count >= 10) return { label: 'Elite',         color: '#FFD700', bg: 'rgba(255,215,0,0.15)',   icon: 'diamond' };
  if (avg >= 4.5 && count >= 5)  return { label: 'Top Joueur',    color: '#FFD700', bg: 'rgba(255,215,0,0.12)',   icon: 'trophy' };
  if (avg >= 4.0 && count >= 3)  return { label: 'Très Apprécié', color: '#C0C0C0', bg: 'rgba(192,192,192,0.15)', icon: 'star' };
  return                                 { label: 'Bien Noté',     color: '#CD7F32', bg: 'rgba(205,127,50,0.15)',  icon: 'thumbs-up' };
}

// ── Schedule helper ──
export function formatScheduleShort(tp: any): string {
  if (tp.event_date) {
    const d = new Date(tp.event_date);
    const today = new Date();
    const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (diff === 0) return `Aujourd'hui à ${time}`;
    if (diff === 1) return `Demain à ${time}`;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ` à ${time}`;
  }
  if (tp.event_schedule) {
    const s = typeof tp.event_schedule === 'string' ? JSON.parse(tp.event_schedule) : tp.event_schedule;
    if (s?.schedule) {
      const days = Object.keys(s.schedule);
      return `Récurrent · ${days.length} jour${days.length > 1 ? 's' : ''}`;
    }
    if (s?.day !== undefined) return 'Récurrent';
  }
  return 'Sans date fixe';
}

// ── StarRow component ──
export function StarRow({ rating, size = 16, onPress }: { rating: number; size?: number; onPress?: (n: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <TouchableOpacity key={n} onPress={() => onPress?.(n)} disabled={!onPress} activeOpacity={onPress ? 0.7 : 1}>
          <Ionicons
            name={n <= rating ? 'star' : 'star-outline'}
            size={size}
            color={n <= rating ? '#FFD700' : Colors.muted}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}
