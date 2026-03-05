import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { Colors, Spacing, Radius } from '../../constants/Colors';

const ORANGE = '#FF9500';

const DAYS_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

function formatSlotDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${DAYS_FULL[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export default function BookingConfirmScreen() {
  const router = useRouter();
  const { serviceId, slotId, locationId, scheduledAt } = useLocalSearchParams<{
    serviceId: string; slotId: string; locationId: string; scheduledAt: string;
  }>();

  const [service, setService] = useState<any>(null);
  const [slot, setSlot] = useState<any>(null);
  const [location, setLocation] = useState<any>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, [serviceId]);

  const loadData = async () => {
    try {
      const svc = await api.get(`/services/${serviceId}`);
      setService(svc);
      const foundSlot = svc.slots?.find((s: any) => s.slot_id === slotId);
      setSlot(foundSlot || null);
      const foundLoc = svc.locations?.find((l: any) => l.location_id === locationId);
      setLocation(foundLoc || svc.locations?.[0] || null);
    } catch {}
    finally { setLoading(false); }
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await api.post('/bookings', {
        service_id: serviceId,
        slot_id: slotId || null,
        location_id: locationId || null,
        scheduled_at: scheduledAt || null,
        notes: notes.trim() || null,
      });
      router.replace('/(tabs)/' as any);
    } catch (err: any) {
      alert(err.message || 'Impossible de créer la réservation');
    } finally {
      setSubmitting(false);
    }
  };

  const getSlotLabel = () => {
    if (!slot) return '';
    const isDate = slot.slot_type === 'single' || slot.slot_type === 'specific';
    if (isDate && slot.slot_date) {
      return `${formatSlotDate(slot.slot_date)}`;
    }
    return DAYS_FULL[slot.day_of_week] ?? '';
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaView edges={['top']}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Confirmer la réservation</Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Service info */}
          {service && (
            <View style={s.serviceCard}>
              {service.images?.[0] && (
                <Image source={{ uri: service.images[0] }} style={s.serviceImg} />
              )}
              <View style={s.serviceInfo}>
                <Text style={s.serviceTitle}>{service.title}</Text>
                <View style={s.coachRow}>
                  <Ionicons name="person-outline" size={13} color={Colors.muted} />
                  <Text style={s.coachName}>{service.coach?.name || 'Coach'}</Text>
                </View>
              </View>
            </View>
          )}

          {/* Divider */}
          <View style={s.divider} />

          {/* Créneau sélectionné */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Créneau sélectionné</Text>
            <View style={s.slotCard} testID="selected-slot-card">
              <View style={s.slotIconWrap}>
                <Ionicons name="calendar" size={22} color={ORANGE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.slotDate}>{getSlotLabel()}</Text>
                {slot && (
                  <Text style={s.slotTime}>
                    {slot.start_time}{slot.end_time ? ` → ${slot.end_time}` : ''}
                    {slot.duration_min ? ` · ${slot.duration_min} min` : ''}
                  </Text>
                )}
                {location && (
                  <View style={s.locRow}>
                    <Ionicons name="location-outline" size={12} color={Colors.muted} />
                    <Text style={s.locText}>{location.description || service?.address || 'Lieu à confirmer'}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Prix */}
          {service && (
            <View style={s.priceCard}>
              <Text style={s.priceLbl}>Prix de la séance</Text>
              <Text style={s.priceVal}>{service.price}€</Text>
            </View>
          )}

          <View style={s.divider} />

          {/* Message optionnel */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>Message au coach</Text>
            <Text style={s.sectionHint}>Optionnel — niveau actuel, objectifs, questions…</Text>
            <TextInput
              style={s.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Ex: Je débute, j'aimerais progresser sur mon endurance…"
              placeholderTextColor={Colors.muted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              testID="notes-input"
            />
          </View>

          {/* Paiement info */}
          <View style={s.paymentNote}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.muted} />
            <Text style={s.paymentNoteText}>
              Le paiement sera demandé uniquement après confirmation du coach.
            </Text>
          </View>
        </ScrollView>

        {/* Confirm button */}
        <SafeAreaView edges={['bottom']} style={s.footer}>
          <TouchableOpacity
            style={[s.confirmBtn, submitting && s.confirmBtnDisabled]}
            onPress={handleConfirm}
            disabled={submitting}
            testID="confirm-booking-btn"
          >
            {submitting ? (
              <ActivityIndicator color={Colors.background} />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={Colors.background} />
                <Text style={s.confirmBtnText}>Envoyer la demande au coach</Text>
              </>
            )}
          </TouchableOpacity>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: Colors.foreground },
  content: { padding: 20, gap: 0 },
  serviceCard: { flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 20 },
  serviceImg: { width: 72, height: 64, borderRadius: 12 },
  serviceInfo: { flex: 1, gap: 4 },
  serviceTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  coachRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  coachName: { fontSize: 13, color: Colors.muted },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 20 },
  section: { gap: 10, marginBottom: 20 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHint: { fontSize: 12, color: Colors.muted, marginTop: -4 },
  slotCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, backgroundColor: Colors.card, borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: 'rgba(255,149,0,0.35)' },
  slotIconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,149,0,0.12)', alignItems: 'center', justifyContent: 'center' },
  slotDate: { fontSize: 17, fontWeight: '800', color: Colors.foreground, letterSpacing: -0.3 },
  slotTime: { fontSize: 14, color: ORANGE, fontWeight: '600', marginTop: 4 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  locText: { fontSize: 12, color: Colors.muted, flex: 1 },
  priceCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 14, padding: 16, marginBottom: 20 },
  priceLbl: { fontSize: 14, color: Colors.muted, fontWeight: '500' },
  priceVal: { fontSize: 22, fontWeight: '800', color: ORANGE },
  notesInput: { backgroundColor: Colors.card, borderRadius: 14, padding: 14, fontSize: 14, color: Colors.foreground, minHeight: 100, borderWidth: 1, borderColor: Colors.border },
  paymentNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: 'rgba(139,148,158,0.08)', borderRadius: 12, padding: 14, marginBottom: 8 },
  paymentNoteText: { flex: 1, fontSize: 13, color: Colors.muted, lineHeight: 18 },
  footer: { paddingHorizontal: 20, paddingBottom: 8, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.background },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 16, marginTop: 12 },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmBtnText: { fontSize: 16, fontWeight: '800', color: Colors.background },
});
