import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { SpotYouCard } from '../SpotYouCard';

const SCREEN_W = Dimensions.get('window').width;
const CARD_WIDTH = SCREEN_W - 48;

interface Props {
  spotYou: any[];
  isOwnProfile: boolean;
  me: any;
  togglingId: string | null;
  onToggleGoing: (item: any) => void;
  onNavigate: (id: string) => void;
  onCreateSpotYou: () => void;
}

export function ProfileSpotYouSection({
  spotYou, isOwnProfile, me, togglingId,
  onToggleGoing, onNavigate, onCreateSpotYou,
}: Props) {
  const [spotYouIndex, setSpotYouIndex] = useState(0);

  if (spotYou.length === 0) {
    return (
      <View style={st.emptySection} testID="empty-spotyou">
        {isOwnProfile ? (
          <View style={st.emptyCTA}>
            <View style={st.emptyCTAIconWrap}>
              <View style={st.emptyCTAIconRing}>
                <Ionicons name="location" size={28} color={Colors.primary} />
              </View>
              <View style={[st.emptyCTADot, { top: 6, left: 8 }]} />
              <View style={[st.emptyCTADot, { top: 14, right: 4, width: 5, height: 5 }]} />
              <View style={[st.emptyCTADot, { bottom: 4, left: 18, width: 4, height: 4 }]} />
            </View>
            <Text style={st.emptyCTATitle}>Partagez vos activités sportives</Text>
            <Text style={st.emptyCTADesc}>
              Créez un SpotYou et invitez la communauté à vous rejoindre pour vos entraînements, sorties ou séances.
            </Text>
            <TouchableOpacity style={st.emptyCTABtn} onPress={onCreateSpotYou}
              activeOpacity={0.88} testID="create-spotyou-cta-btn">
              <Ionicons name="add-circle" size={17} color={Colors.background} />
              <Text style={st.emptyCTABtnText}>Créer un SpotYou</Text>
            </TouchableOpacity>
            <Text style={st.emptyCTAHint}>Gratuit · Visible par toute la communauté</Text>
          </View>
        ) : (
          <View style={st.emptyVisitor}>
            <View style={st.emptyVisitorIcon}>
              <Ionicons name="location-outline" size={26} color={Colors.muted} />
            </View>
            <Text style={st.emptyVisitorTitle}>Aucun SpotYou public</Text>
            <Text style={st.emptyVisitorDesc}>Cet utilisateur n'a pas encore partagé d'activités.</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={st.section}>
      <View style={st.sectionHeader}>
        <View style={st.sectionAccent} />
        <Ionicons name="location-outline" size={14} color={Colors.primary} />
        <Text style={st.sectionTitle}>SpotYou publiés</Text>
        <Text style={st.carouselCount}>{spotYou.length}</Text>
      </View>
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.carouselContent}
        decelerationRate="fast" snapToInterval={CARD_WIDTH + 16} snapToAlignment="start"
        onScroll={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / (CARD_WIDTH + 16));
          setSpotYouIndex(Math.max(0, Math.min(idx, spotYou.length - 1)));
        }}
        scrollEventThrottle={16}
      >
        {spotYou.map((tp: any) => (
          <View key={tp.point_id} style={{ width: CARD_WIDTH }}>
            <SpotYouCard
              item={tp}
              onNavigate={(id) => onNavigate(id)}
              onToggleGoing={() => onToggleGoing(tp)}
              togglingId={togglingId}
              testID={`carousel-tp-${tp.point_id}`}
            />
          </View>
        ))}
      </ScrollView>
      {spotYou.length > 1 && (
        <View style={st.dotsRow}>
          {spotYou.map((_: any, i: number) => (
            <View key={i} style={[st.dot, i === spotYouIndex && st.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  sectionAccent: { width: 3, height: 16, borderRadius: 2, backgroundColor: Colors.primary },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.foreground, textTransform: 'uppercase', letterSpacing: 1.2 },
  carouselCount: {
    marginLeft: 'auto' as any, fontSize: 12, fontWeight: '700',
    color: Colors.primary, backgroundColor: Colors.secondary,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20,
  },
  carouselContent: { paddingHorizontal: 4, gap: 16 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.muted, opacity: 0.4 },
  dotActive: { width: 18, borderRadius: 3, backgroundColor: Colors.primary, opacity: 1 },
  emptySection: { marginHorizontal: Spacing.md, marginBottom: Spacing.lg },
  emptyCTA: {
    backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
    padding: 24, alignItems: 'center',
  },
  emptyCTAIconWrap: { position: 'relative', width: 64, height: 64, marginBottom: 16, alignItems: 'center', justifyContent: 'center' },
  emptyCTAIconRing: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.primary + '15', borderWidth: 1.5, borderColor: Colors.primary + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  emptyCTADot: { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.primary + '40' },
  emptyCTATitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground, textAlign: 'center', marginBottom: 8 },
  emptyCTADesc: { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  emptyCTABtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: Colors.primary, paddingHorizontal: 22, paddingVertical: 11,
    borderRadius: Radius.full, marginBottom: 10,
  },
  emptyCTABtnText: { fontSize: 14, fontWeight: '700', color: Colors.background },
  emptyCTAHint: { fontSize: 11, color: Colors.muted },
  emptyVisitor: {
    backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
    padding: 24, alignItems: 'center', gap: 8,
  },
  emptyVisitorIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyVisitorTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground, textAlign: 'center' },
  emptyVisitorDesc: { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 18 },
});
