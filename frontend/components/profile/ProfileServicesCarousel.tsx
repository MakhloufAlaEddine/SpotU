import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { TEAL_DIM, TEAL_BORDER } from './profileUtils';

const SCREEN_W = Dimensions.get('window').width;
const CARD_WIDTH = SCREEN_W - 48;

interface Props {
  services: any[];
  me: any;
  profileUserId: string;
  onNavigate: (serviceId: string) => void;
}

export function ProfileServicesCarousel({ services, me, profileUserId, onNavigate }: Props) {
  const [serviceIndex, setServiceIndex] = useState(0);

  if (services.length === 0) return null;

  return (
    <View style={st.section}>
      <View style={st.sectionHeader}>
        <View style={st.sectionAccent} />
        <Ionicons name="briefcase-outline" size={14} color={Colors.primary} />
        <Text style={st.sectionTitle}>Services proposés</Text>
        {services.length > 1 && <Text style={st.carouselCount}>{services.length}</Text>}
      </View>
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.carouselContent}
        decelerationRate="fast" snapToInterval={CARD_WIDTH + 16} snapToAlignment="start"
        onScroll={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / (CARD_WIDTH + 16));
          setServiceIndex(Math.max(0, Math.min(idx, services.length - 1)));
        }}
        scrollEventThrottle={16}
      >
        {services.map((svc: any) => {
          const rawImages = svc.images;
          const parsedImages = Array.isArray(rawImages) ? rawImages
            : (typeof rawImages === 'string' ? JSON.parse(rawImages || '[]') : []);
          const svcImage = parsedImages[0] || null;
          return (
            <TouchableOpacity key={svc.service_id}
              style={[st.serviceCard, { width: CARD_WIDTH }]}
              onPress={() => onNavigate(svc.service_id)}
              activeOpacity={0.9} testID={`service-card-${svc.service_id}`}>
              {svcImage
                ? <Image source={{ uri: svcImage }} style={st.serviceImage} />
                : <View style={st.serviceImagePlaceholder}>
                    <Ionicons name="barbell-outline" size={36} color={Colors.primary} />
                  </View>}
              <View style={st.servicePriceBadge}>
                <Text style={st.servicePriceText}>{svc.price}€</Text>
              </View>
              <View style={st.serviceBody}>
                <Text style={st.serviceTitle}>{svc.title}</Text>
                {svc.description && <Text style={st.serviceDesc} numberOfLines={2}>{svc.description}</Text>}
                <View style={st.serviceMetaRow}>
                  <View style={st.metaPill}>
                    <Ionicons name="time-outline" size={14} color="#A1A1AA" />
                    <Text style={st.metaText}>{svc.duration_min} min</Text>
                  </View>
                  <View style={st.metaPill}>
                    <Ionicons name="people-outline" size={14} color="#A1A1AA" />
                    <Text style={st.metaText}>{svc.max_participants} max</Text>
                  </View>
                </View>
                {me && me.user_id !== profileUserId && (
                  <View style={st.reserveBtn} testID={`reserve-btn-${svc.service_id}`}>
                    <Text style={st.reserveBtnText}>Réserver</Text>
                    <Ionicons name="arrow-forward" size={16} color="#0A0A0A" />
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {services.length > 1 && (
        <View style={st.dotsRow}>
          {services.map((_: any, i: number) => (
            <View key={i} style={[st.dot, i === serviceIndex && st.dotActive]} />
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
  serviceCard: { backgroundColor: '#181A1B', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(0,191,165,0.15)', overflow: 'hidden', marginBottom: 4 },
  serviceImage: { width: '100%' as any, height: 180, resizeMode: 'cover' },
  serviceImagePlaceholder: { width: '100%' as any, height: 140, backgroundColor: 'rgba(0,191,165,0.08)', alignItems: 'center', justifyContent: 'center' },
  servicePriceBadge: { position: 'absolute' as any, top: 12, right: 12, backgroundColor: '#00BFA5', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  servicePriceText: { color: '#0A0A0A', fontWeight: '900', fontSize: 15 },
  serviceBody: { padding: 16 },
  serviceTitle: { fontSize: 17, fontWeight: '800', color: '#FFFFFF', flex: 1, marginRight: 12, letterSpacing: -0.2 },
  serviceDesc: { fontSize: 13, color: '#A1A1AA', lineHeight: 20, marginBottom: 14 },
  serviceMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#27272A', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  metaText: { fontSize: 12, fontWeight: '600', color: '#E4E4E7' },
  reserveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#00BFA5', borderRadius: 16, paddingVertical: 14,
    shadowColor: '#00BFA5', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  reserveBtnText: { fontSize: 15, fontWeight: '800', color: '#0A0A0A', textTransform: 'uppercase', letterSpacing: 0.5 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.muted, opacity: 0.4 },
  dotActive: { width: 18, borderRadius: 3, backgroundColor: Colors.primary, opacity: 1 },
});
