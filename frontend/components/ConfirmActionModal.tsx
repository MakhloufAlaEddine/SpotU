import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  Animated, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/Colors';

export interface ConfirmAction {
  title: string;
  description: string;
  icon: string;                    // Ionicons name
  iconColor: string;
  iconBg: string;
  confirmLabel: string;
  confirmStyle: 'primary' | 'danger';
  cancelLabel?: string;
  bullets?: string[];              // liste d'impacts optionnelle
}

interface Props {
  visible: boolean;
  action: ConfirmAction | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmActionModal({ visible, action, onConfirm, onCancel }: Props) {
  const slideAnim = useRef(new Animated.Value(80)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1,  duration: 220, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0,  useNativeDriver: true, damping: 18, stiffness: 200 }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 0,  duration: 160, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 80, duration: 160, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  if (!action) return null;

  const confirmColor = action.confirmStyle === 'danger' ? Colors.error ?? '#EF4444' : Colors.primary;

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent onRequestClose={onCancel}>
      {/* Backdrop */}
      <Animated.View style={[st.backdrop, { opacity: fadeAnim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[st.sheet, { transform: [{ translateY: slideAnim }] }]}
        pointerEvents="box-none"
      >
        {/* Icon */}
        <View style={[st.iconWrap, { backgroundColor: action.iconBg }]}>
          <Ionicons name={action.icon as any} size={28} color={action.iconColor} />
        </View>

        {/* Title */}
        <Text style={st.title}>{action.title}</Text>

        {/* Description */}
        <Text style={st.desc}>{action.description}</Text>

        {/* Bullets (impacts) */}
        {action.bullets && action.bullets.length > 0 && (
          <View style={st.bulletWrap}>
            {action.bullets.map((b, i) => (
              <View key={i} style={st.bulletRow}>
                <View style={[st.bulletDot, { backgroundColor: action.iconColor }]} />
                <Text style={st.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Buttons */}
        <View style={st.btnRow}>
          <TouchableOpacity style={st.cancelBtn} onPress={onCancel} testID="confirm-modal-cancel">
            <Text style={st.cancelText}>{action.cancelLabel ?? 'Annuler'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[st.confirmBtn, { backgroundColor: confirmColor }]}
            onPress={onConfirm}
            testID="confirm-modal-confirm"
          >
            <Text style={st.confirmText}>{action.confirmLabel}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radius.xl ?? 20,
    borderTopRightRadius: Radius.xl ?? 20,
    paddingHorizontal: Spacing.lg ?? 24,
    paddingTop: Spacing.xl ?? 28,
    paddingBottom: 40,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 10,
  },
  iconWrap: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: 18, fontWeight: '700', color: Colors.foreground,
    textAlign: 'center', marginBottom: Spacing.sm ?? 8,
  },
  desc: {
    fontSize: 14, color: Colors.muted, textAlign: 'center',
    lineHeight: 21, marginBottom: Spacing.md,
  },
  bulletWrap: {
    width: '100%', backgroundColor: Colors.background,
    borderRadius: Radius.md ?? 12, padding: Spacing.md,
    marginBottom: Spacing.lg ?? 20, gap: 8,
  },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  bulletText: { flex: 1, fontSize: 13, color: Colors.foreground, lineHeight: 19 },
  btnRow: { flexDirection: 'row', gap: Spacing.sm ?? 10, width: '100%' },
  cancelBtn: {
    flex: 1, paddingVertical: 14,
    borderRadius: Radius.md ?? 12,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.muted },
  confirmBtn: {
    flex: 1.5, paddingVertical: 14,
    borderRadius: Radius.md ?? 12,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
