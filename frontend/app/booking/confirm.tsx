import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Image, Linking, AppState, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { useBookingConfig } from '../../lib/useBookingConfig';

const ORANGE = '#FF9500';
const ORANGE_LIGHT = 'rgba(255,149,0,0.12)';
const BLUE  = '#0A84FF';
const BLUE_LIGHT = 'rgba(10,132,255,0.10)';
const GREEN = '#1DBF73';
const PURPLE = '#635BFF';

const DAYS_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

function formatSlotDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${DAYS_FULL[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ── Countdown hook ─────────────────────────────────────────────────────────────
function useCountdown(expiresAt: string | null | undefined): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!expiresAt) return;
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) { setLabel('Expiré'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const sec = Math.floor((diff % 60000) / 1000);
      if (h > 0) setLabel(`${h}h ${m}m`);
      else if (m > 0) setLabel(`${m}m ${sec}s`);
      else setLabel(`${sec}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return label;
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

  // Flags globaux MVP
  const bookingCfg             = useBookingConfig();
  const enablePayLater         = bookingCfg.enable_pay_later_for_services;
  const enableManualApproval   = bookingCfg.enable_manual_approval_for_services;

  // Résultat booking
  const [booking, setBooking] = useState<any>(null);
  const [pricing, setPricing] = useState<{ payer_total_amount: number } | null>(null);

  // Mode paiement choisi par l'user (forcé à 'pay_now' si pay_later désactivé)
  const [paymentMode, setPaymentMode] = useState<'pay_now' | 'pay_later'>('pay_now');

  // Machine d'état du bouton paiement
  const [payState, setPayState] = useState<'idle' | 'opening' | 'verifying' | 'timeout'>('idle');
  const pendingSessionId  = useRef<string | null>(null);
  const pollingInterval   = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingTimeout    = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Countdown de l'expiration du booking
  const countdownLabel = useCountdown(booking?.expires_at);

  const stopPolling = () => {
    if (pollingInterval.current) { clearInterval(pollingInterval.current); pollingInterval.current = null; }
    if (pollingTimeout.current)  { clearTimeout(pollingTimeout.current);   pollingTimeout.current  = null; }
  };
  useEffect(() => () => stopPolling(), []);

  // ── Flux MVP : Réserver + Payer en une seule action ──────────────────────────
  const handleReserveAndPay = async () => {
    setSubmitting(true);
    // Web: ouvrir fenêtre AVANT les appels async pour éviter le blocage popup navigateur
    // NOTE: window.open n'existe pas en React Native, vérification stricte
    let popupWin: Window | null = null;
    const canUseWindowOpen = typeof window !== 'undefined' && typeof window.open === 'function';
    if (canUseWindowOpen) {
      popupWin = window.open('', '_blank');
      if (popupWin) {
        popupWin.document.write(
          '<html><body style="background:#000;color:#fff;font-family:sans-serif;' +
          'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
          '<p style="font-size:18px">Chargement du paiement…</p></body></html>'
        );
      }
    }
    try {
      // 1. Créer la réservation
      const result = await api.post<any>('/bookings/request', {
        service_id:   serviceId,
        slot_id:      slotId || null,
        location_id:  locationId || null,
        scheduled_at: scheduledAt || null,
        notes:        notes.trim() || null,
        payment_mode: 'pay_now',
      });
      const snap = result.pricing_snapshot;
      setPricing({ payer_total_amount: snap?.payer_total_amount ?? result.amount });
      setBooking(result);

      // 2. Obtenir l'URL Stripe Checkout (sécurisé pour React Native et Web)
      const originUrl = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : '';
      const payRes = await api.post<{ url: string; session_id: string }>(
        `/bookings/${result.booking_id}/pay`,
        { origin_url: originUrl },
      );

      // 3. Rediriger vers Stripe (fenêtre pré-ouverte ou Linking)
      if (popupWin) {
        popupWin.location.href = payRes.url;
      } else {
        await Linking.openURL(payRes.url);
      }

      // 4. Démarrer le polling de confirmation
      if (payRes.session_id) {
        pendingSessionId.current = payRes.session_id;
        startPolling(payRes.session_id, result.booking_id);
      }
    } catch (err: any) {
      if (popupWin) popupWin.close();
      alert(err.message || 'Impossible de créer la réservation');
      setPayState('idle');
      setBooking(null);
    } finally {
      setSubmitting(false);
    }
  };

  const startPolling = (sessionId: string, bid: string) => {
    stopPolling();
    setPayState('verifying');
    const check = async () => {
      try {
        const res = await api.get<any>(`/payments/checkout/status/${sessionId}`);
        const ps = res?.payment_status;
        if (ps === 'authorized' || ps === 'captured' || ps === 'paid') {
          stopPolling();
          pendingSessionId.current = null;
          router.replace(`/payment-success?session_id=${sessionId}&booking_id=${bid}` as any);
        }
      } catch {}
    };
    check();
    pollingInterval.current = setInterval(check, 3000);
    pollingTimeout.current  = setTimeout(() => {
      stopPolling();
      setPayState('timeout');
    }, 180_000);
  };

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && pendingSessionId.current && booking?.booking_id) {
        startPolling(pendingSessionId.current, booking.booking_id);
      }
    });
    return () => sub.remove();
  }, [booking?.booking_id]);

  useEffect(() => { loadData(); }, [serviceId]);

  const loadData = async () => {
    try {
      const svc = await api.get(`/services/${serviceId}`);
      setService(svc);
      // Si le service n'autorise pas le pay_later, forcer pay_now
      if (!svc.allow_pay_later) setPaymentMode('pay_now');
      const foundSlot = svc.slots?.find((s: any) => s.slot_id === slotId);
      setSlot(foundSlot || null);
      const foundLoc = svc.locations?.find((l: any) => l.location_id === locationId);
      setLocation(foundLoc || svc.locations?.[0] || null);
    } catch {}
    finally { setLoading(false); }
  };

  const handleConfirm = async () => {
    if (submitting) return; // Guard double-tap
    setSubmitting(true);
    try {
      const result = await api.post<any>('/bookings/request', {
        service_id:   serviceId,
        slot_id:      slotId || null,
        location_id:  locationId || null,
        scheduled_at: scheduledAt || null,
        notes:        notes.trim() || null,
        // Feature gating : forcer pay_now si le paiement différé est désactivé globalement
        payment_mode: enablePayLater ? paymentMode : 'pay_now',
      });
      const snap = result.pricing_snapshot;
      setPricing({ payer_total_amount: snap?.payer_total_amount ?? result.amount });
      setBooking(result);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('créneau') || msg.includes('réservation'))
        Alert.alert('Créneau indisponible', msg);
      else
        Alert.alert('Erreur', msg || 'Impossible de créer la réservation');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePay = async () => {
    if (!booking?.booking_id) return;
    setPayState('opening');
    try {
      const originUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await api.post<{ url: string; session_id: string }>(
        `/bookings/${booking.booking_id}/pay`,
        { origin_url: originUrl },
      );
      if (res.session_id) pendingSessionId.current = res.session_id;
      await Linking.openURL(res.url);
      startPolling(res.session_id, booking.booking_id);
    } catch (err: any) {
      alert(err.message || 'Impossible de lancer le paiement');
      setPayState('idle');
    }
  };

  const getSlotLabel = () => {
    if (!slot) return '';
    const isDate = slot.slot_type === 'single' || slot.slot_type === 'specific';
    if (isDate && slot.slot_date) return formatSlotDate(slot.slot_date);
    return DAYS_FULL[slot.day_of_week] ?? '';
  };

  const bookingStatus = booking?.status;
  const allowPayLater = service?.allow_pay_later === true;
  // Mode réel depuis le service (conservé pour future réactivation)
  const approvalMode  = service?.booking_approval_mode ?? 'manual_approval';
  // Mode effectif appliqué : respecte le flag global MVP
  // Si enableManualApproval=false, on traite toujours comme instant_booking (feature gating)
  const effectiveApprovalMode = enableManualApproval ? approvalMode : 'instant_booking';

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={ORANGE} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaView edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>
            {booking ? 'Réservation créée' : 'Confirmer la réservation'}
          </Text>
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
                {/* Badge mode réservation — masqué en mode MVP (instant_booking par défaut) */}
                {effectiveApprovalMode !== 'instant_booking' && (
                  <View style={s.bookingModeBadge}>
                    <Ionicons name="hand-left-outline" size={11} color={ORANGE} />
                    <Text style={[s.bookingModeText, { color: ORANGE }]}>Validation manuelle</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          <View style={s.divider} />

          {/* Créneau */}
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

          {/* ── Formulaire (pré-booking) ───────────────────────────────── */}
          {!booking && (
            <>
              {/* Sélecteur mode paiement — seulement si pay_later actif globalement ET pour ce service */}
              {enablePayLater && allowPayLater && (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>Mode de paiement</Text>
                  <View style={s.payModeRow}>
                    <TouchableOpacity
                      style={[s.payModeCard, paymentMode === 'pay_now' && s.payModeCardActive]}
                      onPress={() => setPaymentMode('pay_now')}
                      testID="choose-pay-now"
                    >
                      <View style={s.payModeTop}>
                        <View style={[s.payModeRadio, paymentMode === 'pay_now' && s.payModeRadioActive]}>
                          {paymentMode === 'pay_now' && <View style={s.payModeRadioDot} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.payModeLabel, paymentMode === 'pay_now' && { color: ORANGE }]}>
                            Payer maintenant
                          </Text>
                          <Text style={s.payModeDesc}>Paiement lors de la réservation</Text>
                        </View>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[s.payModeCard, paymentMode === 'pay_later' && s.payModeCardActive]}
                      onPress={() => setPaymentMode('pay_later')}
                      testID="choose-pay-later"
                    >
                      <View style={s.payModeTop}>
                        <View style={[s.payModeRadio, paymentMode === 'pay_later' && s.payModeRadioActive]}>
                          {paymentMode === 'pay_later' && <View style={s.payModeRadioDot} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.payModeLabel, paymentMode === 'pay_later' && { color: ORANGE }]}>
                            Payer plus tard
                          </Text>
                          <Text style={s.payModeDesc}>
                            Le créneau est bloqué, paiement différé
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Message au coach */}
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

              {/* Note dynamique */}
              <View style={s.paymentNote}>
                <Ionicons name="information-circle-outline" size={16} color={Colors.muted} />
                <Text style={s.paymentNoteText}>
                  {!enablePayLater
                    ? (effectiveApprovalMode === 'instant_booking'
                        ? 'Le créneau sera confirmé dès réception du paiement.'
                        : 'Votre moyen de paiement sera confirmé maintenant. Vous ne serez débité définitivement qu\'après acceptation du coach.')
                    : (effectiveApprovalMode === 'instant_booking'
                        ? paymentMode === 'pay_now'
                          ? 'Le créneau sera confirmé dès réception du paiement.'
                          : 'Le créneau sera bloqué pour vous. Le paiement sera demandé dans un délai configuré par le coach.'
                        : paymentMode === 'pay_now'
                          ? 'Votre moyen de paiement sera confirmé maintenant. Vous ne serez débité définitivement qu\'après acceptation du coach.'
                          : 'Votre demande sera soumise au coach. Le paiement sera différé après acceptation.')
                  }
                </Text>
              </View>
            </>
          )}

          {/* ── Résultat booking ───────────────────────────────────────── */}
          {booking && (
            <View style={s.bookingResult}>
              {/* Statut principal */}
              {bookingStatus === 'awaiting_payment' ? (
                <View style={s.resultHeader}>
                  <View style={[s.resultIcon, { backgroundColor: ORANGE + '15' }]}>
                    <Ionicons name="card-outline" size={26} color={ORANGE} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.resultTitle}>Créneau réservé !</Text>
                    <Text style={s.resultSubtitle}>En attente de votre paiement</Text>
                  </View>
                </View>
              ) : bookingStatus === 'requested' ? (
                <View style={s.resultHeader}>
                  <View style={[s.resultIcon, {
                    backgroundColor: (booking?.payment_mode === 'pay_now' ? ORANGE : BLUE) + '15',
                  }]}>
                    <Ionicons
                      name={booking?.payment_mode === 'pay_now' ? 'card-outline' : 'time-outline'}
                      size={26}
                      color={booking?.payment_mode === 'pay_now' ? ORANGE : BLUE}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.resultTitle}>Demande envoyée !</Text>
                    <Text style={s.resultSubtitle}>
                      {booking?.payment_mode === 'pay_now'
                        ? 'Confirmez votre paiement pour sécuriser le créneau'
                        : "En attente d'acceptation du coach"}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={s.resultHeader}>
                  <View style={[s.resultIcon, { backgroundColor: GREEN + '15' }]}>
                    <Ionicons name="checkmark-circle" size={26} color={GREEN} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.resultTitle}>Réservation confirmée !</Text>
                  </View>
                </View>
              )}

              {/* Montant */}
              {pricing && (
                <View style={s.pricingRow}>
                  <Text style={s.pricingLabel}>Total</Text>
                  <Text style={s.pricingTotal}>{pricing.payer_total_amount.toFixed(2)} €</Text>
                </View>
              )}

              {/* Countdown expiry */}
              {booking.expires_at && bookingStatus === 'awaiting_payment' && countdownLabel && (
                <View style={[s.countdownBanner, countdownLabel === 'Expiré' && s.countdownExpired]}>
                  <Ionicons
                    name="timer-outline" size={15}
                    color={countdownLabel === 'Expiré' ? '#FF3B30' : ORANGE}
                  />
                  <Text style={[s.countdownText, countdownLabel === 'Expiré' && { color: '#FF3B30' }]}>
                    {countdownLabel === 'Expiré'
                      ? 'Ce créneau a expiré — le créneau a été libéré'
                      : `Délai de paiement : ${countdownLabel}`}
                  </Text>
                </View>
              )}
            </View>
          )}

        </ScrollView>

        {/* ── Footer bouton ─────────────────────────────────────────────── */}
        <SafeAreaView edges={['bottom']} style={s.footer}>
          {!booking ? (
            <TouchableOpacity
              style={[s.confirmBtn, submitting && s.confirmBtnDisabled]}
              onPress={effectiveApprovalMode === 'instant_booking' ? handleReserveAndPay : handleConfirm}
              disabled={submitting}
              testID="confirm-booking-btn"
            >
              {submitting
                ? <ActivityIndicator color={Colors.background} />
                : <>
                    <Ionicons
                      name={effectiveApprovalMode === 'instant_booking' ? 'card' : 'checkmark-circle'}
                      size={20} color={Colors.background}
                    />
                    <Text style={s.confirmBtnText}>
                      {effectiveApprovalMode === 'instant_booking'
                        ? 'Réserver et payer maintenant'
                        : 'Envoyer la demande'}
                    </Text>
                  </>
              }
            </TouchableOpacity>
          ) : bookingStatus === 'awaiting_payment' ? (
            /* Paiement pour awaiting_payment (retry si Stripe fermé sans payer) */
            <View style={s.paymentStep}>
              {payState === 'idle' && (
                <>
                  <TouchableOpacity
                    style={s.payBtn}
                    onPress={handlePay}
                    testID="pay-now-btn"
                  >
                    <Ionicons name="card" size={20} color={Colors.background} />
                    <Text style={s.confirmBtnText}>Reprendre le paiement</Text>
                  </TouchableOpacity>
                  {booking.payment_mode === 'pay_later' && (
                    <TouchableOpacity
                      style={s.skipPayBtn}
                      onPress={() => router.replace('/bookings' as any)}
                      testID="pay-later-skip-btn"
                    >
                      <Text style={s.skipPayText}>Payer plus tard (dans mes réservations)</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
              {payState === 'opening' && (
                <View style={[s.payBtn, s.payBtnSpinner]}>
                  <ActivityIndicator color={Colors.background} />
                  <Text style={s.confirmBtnText}>Ouverture du paiement...</Text>
                </View>
              )}
              {payState === 'verifying' && (
                <>
                  <View style={[s.payBtn, s.payBtnSpinner]}>
                    <ActivityIndicator color={Colors.background} />
                    <Text style={s.confirmBtnText}>Vérification en cours...</Text>
                  </View>
                  <TouchableOpacity
                    style={s.skipPayBtn}
                    onPress={() => { stopPolling(); setPayState('idle'); }}
                    testID="cancel-verify-btn"
                  >
                    <Text style={s.skipPayText}>Annuler la vérification</Text>
                  </TouchableOpacity>
                </>
              )}
              {payState === 'timeout' && (
                <TouchableOpacity
                  style={[s.payBtn, { backgroundColor: Colors.muted }]}
                  onPress={() => router.push('/bookings' as any)}
                  testID="see-bookings-btn"
                >
                  <Ionicons name="list-outline" size={20} color={Colors.background} />
                  <Text style={s.confirmBtnText}>Voir mes réservations</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            /* Booking requested (manual_approval) */
            <View style={s.paymentStep}>
              {booking?.payment_mode === 'pay_now' ? (
                /* pay_now : autorisation immédiate du paiement */
                <>
                  <View style={[s.requestedNote, { borderColor: ORANGE + '30', backgroundColor: ORANGE_LIGHT }]}>
                    <Ionicons name="shield-checkmark-outline" size={18} color={ORANGE} />
                    <Text style={[s.requestedNoteText, { color: Colors.foreground }]}>
                      Confirmez votre moyen de paiement. Vous ne serez débité qu'après acceptation du coach.
                    </Text>
                  </View>
                  {payState === 'idle' && (
                    <TouchableOpacity
                      style={s.payBtn}
                      onPress={handlePay}
                      testID="authorize-pay-btn"
                    >
                      <Ionicons name="card" size={20} color={Colors.background} />
                      <Text style={s.confirmBtnText}>Confirmer mon moyen de paiement</Text>
                    </TouchableOpacity>
                  )}
                  {payState === 'opening' && (
                    <View style={[s.payBtn, s.payBtnSpinner]}>
                      <ActivityIndicator color={Colors.background} />
                      <Text style={s.confirmBtnText}>Ouverture du paiement...</Text>
                    </View>
                  )}
                  {payState === 'verifying' && (
                    <>
                      <View style={[s.payBtn, s.payBtnSpinner]}>
                        <ActivityIndicator color={Colors.background} />
                        <Text style={s.confirmBtnText}>Vérification en cours...</Text>
                      </View>
                      <TouchableOpacity
                        style={s.skipPayBtn}
                        onPress={() => { stopPolling(); setPayState('idle'); }}
                        testID="cancel-verify-btn"
                      >
                        <Text style={s.skipPayText}>Annuler la vérification</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  {payState === 'timeout' && (
                    <TouchableOpacity
                      style={[s.payBtn, { backgroundColor: Colors.muted }]}
                      onPress={() => router.push('/bookings' as any)}
                      testID="see-bookings-btn"
                    >
                      <Ionicons name="list-outline" size={20} color={Colors.background} />
                      <Text style={s.confirmBtnText}>Voir mes réservations</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                /* pay_later : en attente d'acceptation coach */
                <>
                  <View style={s.requestedNote}>
                    <Ionicons name="mail-outline" size={18} color={BLUE} />
                    <Text style={s.requestedNoteText}>
                      Votre demande a été envoyée. Vous pourrez payer après l'acceptation du coach.
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[s.payBtn, { backgroundColor: BLUE }]}
                    onPress={() => router.push('/bookings' as any)}
                    testID="goto-bookings-btn"
                  >
                    <Ionicons name="list-outline" size={18} color={Colors.background} />
                    <Text style={s.confirmBtnText}>Suivre ma réservation</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
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

  serviceCard: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 20 },
  serviceImg: { width: 72, height: 64, borderRadius: 12 },
  serviceInfo: { flex: 1, gap: 4 },
  serviceTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  coachRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  coachName: { fontSize: 13, color: Colors.muted },
  bookingModeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  bookingModeText: { fontSize: 11, fontWeight: '700' },

  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 20 },
  section: { gap: 10, marginBottom: 20 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHint: { fontSize: 12, color: Colors.muted, marginTop: -4 },

  slotCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, backgroundColor: Colors.card, borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: 'rgba(255,149,0,0.35)' },
  slotIconWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: ORANGE_LIGHT, alignItems: 'center', justifyContent: 'center' },
  slotDate: { fontSize: 17, fontWeight: '800', color: Colors.foreground, letterSpacing: -0.3 },
  slotTime: { fontSize: 14, color: ORANGE, fontWeight: '600', marginTop: 4 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  locText: { fontSize: 12, color: Colors.muted, flex: 1 },

  priceCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 14, padding: 16, marginBottom: 20 },
  priceLbl: { fontSize: 14, color: Colors.muted, fontWeight: '500' },
  priceVal: { fontSize: 22, fontWeight: '800', color: ORANGE },

  // Payment mode selector
  payModeRow: { flexDirection: 'row', gap: 10 },
  payModeCard: { flex: 1, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card, padding: 12 },
  payModeCardActive: { borderColor: ORANGE, backgroundColor: ORANGE_LIGHT },
  payModeTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  payModeRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0 },
  payModeRadioActive: { borderColor: ORANGE },
  payModeRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE },
  payModeLabel: { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  payModeDesc: { fontSize: 11, color: Colors.muted, marginTop: 2, lineHeight: 16 },

  notesInput: { backgroundColor: Colors.card, borderRadius: 14, padding: 14, fontSize: 14, color: Colors.foreground, minHeight: 100, borderWidth: 1, borderColor: Colors.border },
  paymentNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: 'rgba(139,148,158,0.08)', borderRadius: 12, padding: 14, marginBottom: 8 },
  paymentNoteText: { flex: 1, fontSize: 13, color: Colors.muted, lineHeight: 18 },

  // Booking result
  bookingResult: { gap: 14 },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Colors.border },
  resultIcon: { width: 50, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  resultTitle: { fontSize: 17, fontWeight: '800', color: Colors.foreground },
  resultSubtitle: { fontSize: 13, color: Colors.muted, marginTop: 2 },

  pricingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.border },
  pricingLabel: { fontSize: 14, color: Colors.muted },
  pricingTotal: { fontSize: 22, fontWeight: '800', color: ORANGE },

  countdownBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: ORANGE_LIGHT, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: ORANGE + '40' },
  countdownExpired: { backgroundColor: 'rgba(255,59,48,0.10)', borderColor: '#FF3B30' + '40' },
  countdownText: { fontSize: 13, fontWeight: '700', color: ORANGE, flex: 1 },

  requestedNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: BLUE_LIGHT, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: BLUE + '30' },
  requestedNoteText: { flex: 1, fontSize: 13, color: Colors.foreground, lineHeight: 18 },

  footer: { paddingHorizontal: 20, paddingBottom: 8, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.background },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ORANGE, borderRadius: Radius.full, paddingVertical: 16, marginTop: 12 },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmBtnText: { fontSize: 16, fontWeight: '800', color: Colors.background },
  paymentStep: { gap: 8, paddingTop: 12 },
  payBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: PURPLE, borderRadius: Radius.full, paddingVertical: 16 },
  payBtnSpinner: { opacity: 0.8 },
  skipPayBtn: { alignItems: 'center', paddingVertical: 8 },
  skipPayText: { fontSize: 14, color: Colors.muted },
});
