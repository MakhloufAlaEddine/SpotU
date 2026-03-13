import React, { useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  ActivityIndicator, Animated, PanResponder, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { COVER_H, COVER_IMG_H, MAX_OFFSET_PX } from './profileUtils';

const SCREEN_W = Dimensions.get('window').width;

interface Props {
  visible: boolean;
  coverUri: string | null;
  saving: boolean;
  // Animated values (shared with parent for syncing)
  animImgWidth: Animated.AnimatedMultiplication;
  animImgHeight: Animated.AnimatedMultiplication;
  animImgLeft: Animated.AnimatedMultiplication;
  repoTopAnim: Animated.Value;
  repoScaleAnim: Animated.Value;
  repoTopRef: React.MutableRefObject<number>;
  repoScaleRef: React.MutableRefObject<number>;
  onSave: () => void;
  onCancel: () => void;
}

export function CoverRepositionModal({
  visible, coverUri, saving,
  animImgWidth, animImgHeight, animImgLeft, repoTopAnim, repoScaleAnim,
  repoTopRef, repoScaleRef,
  onSave, onCancel,
}: Props) {
  const isPinchingRef = useRef(false);
  const pinchInitDistRef = useRef(0);
  const pinchInitScaleRef = useRef(1.0);
  const lastSingleTouchY = useRef(0);

  const getTouchDist = (t1: any, t2: any) =>
    Math.sqrt(Math.pow(t1.pageX - t2.pageX, 2) + Math.pow(t1.pageY - t2.pageY, 2));

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: (evt) => {
        repoTopRef.current = (repoTopAnim as any)._value;
        repoScaleRef.current = (repoScaleAnim as any)._value;
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          isPinchingRef.current = true;
          pinchInitDistRef.current = getTouchDist(touches[0], touches[1]);
          pinchInitScaleRef.current = repoScaleRef.current;
        } else {
          isPinchingRef.current = false;
          lastSingleTouchY.current = touches[0]?.pageY ?? 0;
        }
      },

      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          if (!isPinchingRef.current) {
            isPinchingRef.current = true;
            pinchInitDistRef.current = getTouchDist(touches[0], touches[1]);
            pinchInitScaleRef.current = (repoScaleAnim as any)._value;
            repoTopRef.current = (repoTopAnim as any)._value;
          }
          const ratio = getTouchDist(touches[0], touches[1]) / pinchInitDistRef.current;
          const newScale = Math.max(1.0, Math.min(3.0, pinchInitScaleRef.current * ratio));
          repoScaleAnim.setValue(newScale);
          repoScaleRef.current = newScale;
          const maxDrag = COVER_IMG_H * newScale - COVER_H;
          repoTopAnim.setValue(Math.max(-maxDrag, Math.min(0, repoTopRef.current)));
        } else if (touches.length === 1) {
          if (isPinchingRef.current) {
            isPinchingRef.current = false;
            repoTopRef.current = (repoTopAnim as any)._value;
            lastSingleTouchY.current = touches[0].pageY;
          }
          const scale = (repoScaleAnim as any)._value;
          const maxDrag = COVER_IMG_H * scale - COVER_H;
          const dy = touches[0].pageY - lastSingleTouchY.current;
          const newTop = Math.max(-maxDrag, Math.min(0, repoTopRef.current + dy));
          repoTopAnim.setValue(newTop);
          lastSingleTouchY.current = touches[0].pageY;
          repoTopRef.current = newTop;
        }
      },

      onPanResponderRelease: () => {
        repoTopRef.current = (repoTopAnim as any)._value;
        repoScaleRef.current = (repoScaleAnim as any)._value;
        isPinchingRef.current = false;
      },
    })
  ).current;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={st.overlay}>
        <View style={st.header}>
          <TouchableOpacity onPress={onCancel} style={st.headerBtn} testID="reposition-cancel-btn">
            <Ionicons name="close" size={20} color="rgba(255,255,255,0.8)" />
            <Text style={st.headerBtnText}>Annuler</Text>
          </TouchableOpacity>
          <Text style={st.headerTitle}>Repositionner</Text>
          <TouchableOpacity onPress={onSave} style={st.headerBtn} disabled={saving} testID="reposition-save-btn">
            {saving
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : <>
                  <Ionicons name="checkmark" size={20} color={Colors.primary} />
                  <Text style={[st.headerBtnText, { color: Colors.primary }]}>Enregistrer</Text>
                </>}
          </TouchableOpacity>
        </View>
        <View style={st.coverFrame} {...panResponder.panHandlers}>
          {coverUri && (
            <Animated.Image
              source={{ uri: coverUri }}
              style={[st.coverImg, {
                width: animImgWidth, height: animImgHeight,
                left: animImgLeft, top: repoTopAnim,
              }]}
            />
          )}
          <View style={st.guideLine} pointerEvents="none" />
        </View>
        <View style={st.hintsRow}>
          <View style={st.hint}>
            <Ionicons name="swap-vertical-outline" size={15} color="rgba(255,255,255,0.6)" />
            <Text style={st.hintText}>Glisser pour cadrer</Text>
          </View>
          <View style={st.hintDivider} />
          <View style={st.hint}>
            <Ionicons name="search-outline" size={15} color="rgba(255,255,255,0.6)" />
            <Text style={st.hintText}>Pincer pour zoomer</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', paddingHorizontal: 16, paddingVertical: 14, paddingTop: 48,
  },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 4, paddingVertical: 6 },
  headerBtnText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.3 },
  coverFrame: {
    width: SCREEN_W, height: COVER_H, overflow: 'hidden',
    backgroundColor: '#0D2420', borderWidth: 1, borderColor: 'rgba(0,191,165,0.3)', position: 'relative',
  },
  coverImg: { position: 'absolute', resizeMode: 'cover' } as any,
  guideLine: {
    position: 'absolute', left: 0, right: 0, top: COVER_H / 2 - 0.5,
    height: 1, backgroundColor: 'rgba(255,255,255,0.15)',
  },
  hintsRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: 20,
    paddingHorizontal: 24, paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 20, gap: 10,
  },
  hintDivider: { width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.2)' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hintText: { fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: '500' },
});
