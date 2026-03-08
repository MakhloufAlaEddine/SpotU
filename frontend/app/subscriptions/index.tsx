/**
 * app/subscriptions/index.tsx — Plans & Abonnement
 *
 * Règles :
 *  - Plans et statut d'abonnement depuis /subscription-plans et /subscriptions/me
 *  - Souscription → Stripe Checkout via /subscriptions/subscribe
 *  - Annulation → /subscriptions/cancel
 *  - Aucun calcul de prix côté frontend
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { Colors, Radius } from '../../constants/Colors';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Plan {
  plan_id: string;
  name: string;
  description: string;
  price: number;
  duration_days: number;
  exempt_payer_fixed: boolean;
  exempt_payer_percent: boolean;
  exempt_receiver_fixed: boolean;
  exempt_receiver_percent: boolean;
  active: boolean;
  priority: number;
}

interface Subscription {
  subscription_id: string;
  plan_id: string;
  plan_name?: string;
  status: string;
  expires_at: string | null;
  stripe_subscription_id?: string;
}

const SUB_STATUS: Record<string, { label: string; color: string }> = {
  active:      { label: 'Actif',             color: '#34C759' },
  cancelling:  { label: 'Annulation prévue', color: '#FF9500' },
  cancelled:   { label: 'Annulé',            color: '#FF3B30' },
  past_due:    { label: 'Paiement en retard',color: '#FF3B30' },
  trialing:    { label: 'Période d\'essai',  color: '#007AFF' },
};

function buildBenefits(plan: Plan): string[] {
  const benefits: string[] = [];
  if (plan.exempt_payer_fixed && plan.exempt_payer_percent)
    benefits.push('Tous les frais payeur offerts');
  else if (plan.exempt_payer_fixed)
    benefits.push('Frais fixes payeur offerts');
  else if (plan.exempt_payer_percent)
    benefits.push('Frais variables payeur offerts');
  if (plan.exempt_receiver_fixed && plan.exempt_receiver_percent)
    benefits.push('Tous les frais receveur offerts');
  else if (plan.exempt_receiver_fixed)
    benefits.push('Frais fixes receveur offerts');
  if (benefits.length === 0) benefits.push('Accès standard');
  return benefits;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Carte plan ─────────────────────────────────────────────────────────────────

function PlanCard({
  plan, isCurrent, onSubscribe, subscribing,
}: {
  plan: Plan; isCurrent: boolean; onSubscribe: () => void; subscribing: boolean;
}) {
  const benefits = buildBenefits(plan);
  const isAnnual = plan.duration_days >= 300;
  const accentColor = isCurrent ? Colors.primary : (isAnnual ? '#FFD700' : '#007AFF');

  return (
    <View
      style={[p.card, isCurrent && p.cardCurrent, { borderColor: accentColor + '44' }]}
      testID={`plan-card-${plan.plan_id}`}
    >
      {/* Header */}
      <View style={p.planHeader}>
        <View style={{ flex: 1 }}>
          <View style={p.planTitleRow}>
            <Text style={p.planName}>{plan.name}</Text>
            {isAnnual && (
              <View style={p.annualBadge}>
                <Text style={p.annualBadgeTxt}>Annuel</Text>
              </View>
            )}
            {isCurrent && (
              <View style={[p.currentBadge, { backgroundColor: Colors.primary + '22' }]}>
                <Ionicons name="checkmark-circle" size={12} color={Colors.primary} />
                <Text style={[p.currentBadgeTxt, { color: Colors.primary }]}>Actuel</Text>
              </View>
            )}
          </View>
          {plan.description ? (
            <Text style={p.planDesc}>{plan.description}</Text>
          ) : null}
        </View>
        <View style={p.priceBox}>
          <Text style={[p.price, { color: accentColor }]}>{plan.price.toFixed(2)} €</Text>
          <Text style={p.pricePer}>/{isAnnual ? 'an' : 'mois'}</Text>
        </View>
      </View>

      {/* Bénéfices */}
      <View style={p.benefitsList}>
        {benefits.map((b, i) => (
          <View key={i} style={p.benefitRow}>
            <Ionicons name="checkmark-circle" size={14} color={accentColor} />
            <Text style={p.benefitText}>{b}</Text>
          </View>
        ))}
      </View>

      {/* CTA */}
      {!isCurrent && (
        <TouchableOpacity
          style={[p.subscribeBtn, subscribing && { opacity: 0.5 }, { backgroundColor: accentColor }]}
          onPress={onSubscribe}
          disabled={subscribing}
          testID={`subscribe-btn-${plan.plan_id}`}
        >
          {subscribing
            ? <ActivityIndicator size="small" color={Colors.background} />
            : <>
                <Ionicons name="card-outline" size={16} color={Colors.background} />
                <Text style={p.subscribeBtnTxt}>Souscrire — {plan.price.toFixed(2)} €/{isAnnual ? 'an' : 'mois'}</Text>
              </>
          }
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Carte abonnement actif ─────────────────────────────────────────────────────

function ActiveSubCard({
  subscription, planName, onCancel, cancelling,
}: {
  subscription: Subscription; planName: string; onCancel: () => void; cancelling: boolean;
}) {
  const st = SUB_STATUS[subscription.status] ?? { label: subscription.status, color: Colors.muted };
  const canCancel = ['active', 'trialing'].includes(subscription.status);

  return (
    <View style={sub.card} testID="active-subscription-card">
      <View style={sub.headerRow}>
        <View style={[sub.iconBox, { backgroundColor: Colors.primary + '22' }]}>
          <Ionicons name="ribbon-outline" size={22} color={Colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sub.planName}>{planName}</Text>
          <View style={[sub.statusBadge, { backgroundColor: st.color + '22' }]}>
            <View style={[sub.statusDot, { backgroundColor: st.color }]} />
            <Text style={[sub.statusText, { color: st.color }]}>{st.label}</Text>
          </View>
        </View>
      </View>

      {subscription.expires_at && (
        <View style={sub.expiryRow}>
          <Ionicons name="calendar-outline" size={14} color={Colors.muted} />
          <Text style={sub.expiryText}>
            {subscription.status === 'cancelling'
              ? `Actif jusqu'au ${formatDate(subscription.expires_at)}`
              : `Renouvellement le ${formatDate(subscription.expires_at)}`}
          </Text>
        </View>
      )}

      {subscription.status === 'cancelling' && (
        <View style={sub.infoBox}>
          <Ionicons name="information-circle-outline" size={15} color="#FF9500" />
          <Text style={sub.infoText}>
            Votre abonnement sera annulé à la fin de la période en cours. Vous conservez vos avantages jusqu'à cette date.
          </Text>
        </View>
      )}

      {subscription.status === 'past_due' && (
        <View style={[sub.infoBox, { backgroundColor: '#FF3B3011' }]}>
          <Ionicons name="warning-outline" size={15} color="#FF3B30" />
          <Text style={[sub.infoText, { color: '#FF3B30' }]}>
            Le dernier paiement a échoué. Vérifiez votre moyen de paiement.
          </Text>
        </View>
      )}

      {canCancel && (
        <TouchableOpacity
          style={[sub.cancelBtn, cancelling && { opacity: 0.5 }]}
          onPress={onCancel}
          disabled={cancelling}
          testID="cancel-subscription-btn"
        >
          {cancelling
            ? <ActivityIndicator size="small" color="#FF3B30" />
            : <Text style={sub.cancelBtnTxt}>Annuler l'abonnement</Text>
          }
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Écran principal ────────────────────────────────────────────────────────────

export default function SubscriptionsScreen() {
  const router = useRouter();
  const [plans, setPlans]         = useState<Plan[]>([]);
  const [subData, setSubData]     = useState<{ has_subscription: boolean; subscription: Subscription | null } | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [cancelling, setCancelling]   = useState(false);

  const load = useCallback(async () => {
    try {
      const [plansData, subInfo] = await Promise.all([
        api.get<Plan[]>('/subscription-plans'),
        api.get<any>('/subscriptions/me'),
      ]);
      const sorted = (plansData || []).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
      setPlans(sorted);
      setSubData(subInfo);
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const handleSubscribe = async (planId: string) => {
    setSubscribing(planId);
    try {
      const originUrl = typeof window !== 'undefined'
        ? window.location.origin
        : process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const res = await api.post<{ url: string; session_id: string }>('/subscriptions/subscribe', {
        plan_id: planId,
        origin_url: originUrl,
      });
      if (typeof window !== 'undefined') {
        window.location.href = res.url;
      } else {
        await Linking.openURL(res.url);
      }
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de lancer l\'abonnement');
      setSubscribing(null);
    }
  };

  const handleCancel = async () => {
    Alert.alert(
      'Annuler l\'abonnement',
      'Votre abonnement restera actif jusqu\'à la fin de la période en cours, puis sera annulé automatiquement.',
      [
        { text: 'Garder l\'abonnement', style: 'cancel' },
        {
          text: 'Annuler quand même', style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await api.post('/subscriptions/cancel');
              await load();
            } catch (err: any) {
              Alert.alert('Erreur', err.message || 'Impossible d\'annuler l\'abonnement');
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  const activeSub    = subData?.subscription;
  const hasSub       = subData?.has_subscription && activeSub;
  const currentPlanId = activeSub?.plan_id ?? null;
  const currentPlanName = hasSub
    ? (plans.find(p => p.plan_id === currentPlanId)?.name ?? activeSub?.plan_name ?? 'Plan actif')
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.header }}>
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Abonnements</Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 80 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />
          }
        >
          {/* ── Abonnement actif ── */}
          {hasSub && activeSub && currentPlanName && (
            <View>
              <Text style={s.sectionTitle}>Mon abonnement actuel</Text>
              <ActiveSubCard
                subscription={activeSub}
                planName={currentPlanName}
                onCancel={handleCancel}
                cancelling={cancelling}
              />
            </View>
          )}

          {/* ── Plans disponibles ── */}
          <View>
            <Text style={s.sectionTitle}>
              {hasSub ? 'Changer de plan' : 'Choisir un plan'}
            </Text>
            <Text style={s.sectionDesc}>
              Les avantages s'appliquent immédiatement à vos réservations.
            </Text>
            {plans.filter(p => p.active).map(plan => (
              <View key={plan.plan_id} style={{ marginBottom: 12 }}>
                <PlanCard
                  plan={plan}
                  isCurrent={plan.plan_id === currentPlanId && !!hasSub}
                  onSubscribe={() => handleSubscribe(plan.plan_id)}
                  subscribing={subscribing === plan.plan_id}
                />
              </View>
            ))}
          </View>

          {/* ── Note informative ── */}
          <View style={s.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.muted} />
            <Text style={s.infoText}>
              Les paiements sont sécurisés par Stripe. Vous pouvez annuler à tout moment.
              Les prix s'entendent TTC.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12 },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.card },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: Colors.foreground },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  sectionDesc: { fontSize: 13, color: Colors.muted, marginBottom: 14, lineHeight: 18 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: Colors.card, borderRadius: 12, padding: 14 },
  infoText: { flex: 1, fontSize: 12, color: Colors.muted, lineHeight: 18 },
});

const p = StyleSheet.create({
  card: {
    backgroundColor: Colors.card, borderRadius: 16,
    borderWidth: 1.5, borderColor: Colors.border, overflow: 'hidden',
  },
  cardCurrent: { borderColor: Colors.primary },
  planHeader: { flexDirection: 'row', alignItems: 'flex-start', padding: 16, gap: 12 },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  planName: { fontSize: 17, fontWeight: '800', color: Colors.foreground },
  planDesc: { fontSize: 12, color: Colors.muted, lineHeight: 17 },
  annualBadge: { backgroundColor: '#FFD70022', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  annualBadgeTxt: { fontSize: 10, fontWeight: '700', color: '#FFD700' },
  currentBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  currentBadgeTxt: { fontSize: 10, fontWeight: '700' },
  priceBox: { alignItems: 'flex-end' },
  price: { fontSize: 22, fontWeight: '900', lineHeight: 26 },
  pricePer: { fontSize: 11, color: Colors.muted, fontWeight: '500' },
  benefitsList: { paddingHorizontal: 16, paddingBottom: 4, gap: 7 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  benefitText: { fontSize: 13, color: Colors.foreground, flex: 1 },
  subscribeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, margin: 16, paddingVertical: 13, borderRadius: Radius.full,
  },
  subscribeBtnTxt: { fontSize: 14, fontWeight: '700', color: Colors.background },
});

const sub = StyleSheet.create({
  card: {
    backgroundColor: Colors.card, borderRadius: 16,
    borderWidth: 1.5, borderColor: Colors.primary + '44', padding: 16, gap: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconBox: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  planName: { fontSize: 17, fontWeight: '800', color: Colors.foreground, marginBottom: 4 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: '600' },
  expiryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  expiryText: { fontSize: 13, color: Colors.muted },
  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    backgroundColor: '#FF950011', borderRadius: 10, padding: 12,
  },
  infoText: { flex: 1, fontSize: 12, color: '#FF9500', lineHeight: 18 },
  cancelBtn: {
    alignItems: 'center', paddingVertical: 10,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#FF3B3040',
    marginTop: 4,
  },
  cancelBtnTxt: { fontSize: 14, fontWeight: '600', color: '#FF3B30' },
});
