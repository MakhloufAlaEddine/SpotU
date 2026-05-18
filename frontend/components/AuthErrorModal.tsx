import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius } from '../constants/Colors';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  onClose: () => void;
};

export function AuthErrorModal({ visible, title, message, onClose }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons name="alert-circle" size={28} color="#FF6B6B" />
            </View>
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            <Text style={styles.body} selectable>
              {message}
            </Text>
          </ScrollView>
          <TouchableOpacity style={styles.btn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.btnText}>OK</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: '#0E2626',
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: '#1A3A3A',
    maxHeight: '72%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,107,107,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: Colors.foreground,
  },
  scroll: { maxHeight: 280 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 8 },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: '#B0C4C4',
    fontWeight: '500',
  },
  btn: {
    marginHorizontal: 20,
    marginBottom: 20,
    marginTop: 12,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnText: { fontSize: 16, fontWeight: '700', color: '#000' },
});
