import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Switch, TextInput, Modal, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { Colors, Spacing } from '../../constants/Colors';

// ── Types ─────────────────────────────────────────────────────────────────────
type Tab = 'stats' | 'rules' | 'plans' | 'payments' | 'booking';

interface PricingRule {
  rule_id: string; name: string; product_type: string;
  payer_fixed_fee: number; payer_percent_fee: number;
  receiver_fixed_fee: number; receiver_percent_fee: number;
  active: boolean; priority: number; description?: string;
}
interface SubscriptionPlan {
  plan_id: string; name: string; description?: string;
  price: number; duration_days?: number;
  exempt_payer_fixed: boolean; exempt_payer_percent: boolean;
  exempt_receiver_fixed: boolean; exempt_receiver_percent: boolean;
  active: boolean; priority: number;
}
interface Stats {
  total_users: number; total_coaches: number; total_tagpoints: number;
  total_bookings: number; total_paid_bookings: number;
  gmv: number; platform_commission: number;
}

const PRODUCT_TYPES = ['service_booking', 'subscription', 'tip', 'custom'];

// ── Helper composants ─────────────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <View style={s.statCard}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
      {sub ? <Text style={s.statSub}>{sub}</Text> : null}
    </View>
  );
}

function SectionHeader({ title, onAdd }: { title: string; onAdd?: () => void }) {
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{title}</Text>
      {onAdd && (
        <TouchableOpacity style={s.addBtn} onPress={onAdd} testID={`add-${title.toLowerCase().replace(/ /g, '-')}`}>
          <Ionicons name="add" size={18} color={Colors.background} />
          <Text style={s.addBtnText}>Nouveau</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function ExemptBadge({ label, active }: { label: string; active: boolean }) {
  if (!active) return null;
  return <View style={s.exemptBadge}><Text style={s.exemptBadgeText}>{label}</Text></View>;
}

// ── Onglet Stats ──────────────────────────────────────────────────────────────
function StatsTab({ stats }: { stats: Stats | null }) {
  if (!stats) return <View style={s.center}><ActivityIndicator color={Colors.primary} /></View>;
  return (
    <ScrollView contentContainerStyle={s.tabContent}>
      <Text style={s.tabSectionTitle}>Utilisateurs</Text>
      <View style={s.statsGrid}>
        <StatCard label="Utilisateurs" value={stats.total_users} />
        <StatCard label="Coaches" value={stats.total_coaches} />
        <StatCard label="SpotYous" value={stats.total_tagpoints} />
      </View>
      <Text style={[s.tabSectionTitle, { marginTop: 20 }]}>Financier</Text>
      <View style={s.statsGrid}>
        <StatCard label="Réservations" value={stats.total_bookings} />
        <StatCard label="Payées" value={stats.total_paid_bookings} />
        <StatCard label="GMV" value={`${stats.gmv.toFixed(2)} €`} sub="volume total payé" />
        <StatCard label="Frais plateforme" value={`${stats.platform_commission.toFixed(2)} €`} sub="depuis snapshots" />
      </View>
    </ScrollView>
  );
}

// ── Formulaire règle tarifaire ────────────────────────────────────────────────
function RuleForm({ initial, onSave, onClose }: {
  initial: Partial<PricingRule> | null;
  onSave: (data: Partial<PricingRule>) => Promise<void>;
  onClose: () => void;
}) {
  const isNew = !initial?.rule_id;
  const [form, setForm] = useState<Partial<PricingRule>>({
    name: '', product_type: 'service_booking',
    payer_fixed_fee: 0, payer_percent_fee: 0,
    receiver_fixed_fee: 0, receiver_percent_fee: 0,
    active: true, priority: 0, description: '',
    ...initial,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof PricingRule, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name?.trim()) return Alert.alert('Erreur', 'Le nom est requis');
    setSaving(true);
    try { await onSave(form); }
    finally { setSaving(false); }
  };

  return (
    <View style={mf.modal}>
      <View style={mf.header}>
        <Text style={mf.title}>{isNew ? 'Nouvelle règle' : 'Modifier la règle'}</Text>
        <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={Colors.muted} /></TouchableOpacity>
      </View>
      <ScrollView style={mf.body} keyboardShouldPersistTaps="handled">
        <Label>Nom *</Label>
        <TextInput style={mf.input} value={form.name} onChangeText={v => set('name', v)} placeholder="Ex: Standard" placeholderTextColor={Colors.muted} testID="rule-name-input" />

        <Label>Type de produit *</Label>
        <View style={mf.chipRow}>
          {PRODUCT_TYPES.map(pt => (
            <TouchableOpacity key={pt} style={[mf.chip, form.product_type === pt && mf.chipActive]}
              onPress={() => set('product_type', pt)} testID={`rule-type-${pt}`}>
              <Text style={[mf.chipText, form.product_type === pt && mf.chipTextActive]}>{pt}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Label>Description</Label>
        <TextInput style={mf.input} value={form.description || ''} onChangeText={v => set('description', v)} placeholder="Optionnel" placeholderTextColor={Colors.muted} />

        <Text style={mf.groupTitle}>Frais côté payeur</Text>
        <View style={mf.feeRow}>
          <View style={{ flex: 1 }}>
            <Label>Fixe (€)</Label>
            <TextInput style={mf.input} keyboardType="decimal-pad" value={String(form.payer_fixed_fee ?? 0)}
              onChangeText={v => set('payer_fixed_fee', parseFloat(v) || 0)} testID="payer-fixed-input" />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Label>Pourcentage (%)</Label>
            <TextInput style={mf.input} keyboardType="decimal-pad" value={String(form.payer_percent_fee ?? 0)}
              onChangeText={v => set('payer_percent_fee', parseFloat(v) || 0)} testID="payer-percent-input" />
          </View>
        </View>

        <Text style={mf.groupTitle}>Frais côté bénéficiaire</Text>
        <View style={mf.feeRow}>
          <View style={{ flex: 1 }}>
            <Label>Fixe (€)</Label>
            <TextInput style={mf.input} keyboardType="decimal-pad" value={String(form.receiver_fixed_fee ?? 0)}
              onChangeText={v => set('receiver_fixed_fee', parseFloat(v) || 0)} testID="receiver-fixed-input" />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Label>Pourcentage (%)</Label>
            <TextInput style={mf.input} keyboardType="decimal-pad" value={String(form.receiver_percent_fee ?? 0)}
              onChangeText={v => set('receiver_percent_fee', parseFloat(v) || 0)} testID="receiver-percent-input" />
          </View>
        </View>

        <View style={mf.switchRow}>
          <View style={{ flex: 1 }}>
            <Label>Priorité</Label>
            <TextInput style={mf.input} keyboardType="number-pad" value={String(form.priority ?? 0)}
              onChangeText={v => set('priority', parseInt(v) || 0)} />
          </View>
          <View style={mf.switchBlock}>
            <Label>Active</Label>
            <Switch value={form.active} onValueChange={v => set('active', v)}
              trackColor={{ true: Colors.primary }} thumbColor="#fff" testID="rule-active-switch" />
          </View>
        </View>
      </ScrollView>

      <TouchableOpacity style={[mf.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving} testID="save-rule-btn">
        {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={mf.saveBtnText}>Enregistrer</Text>}
      </TouchableOpacity>
    </View>
  );
}

// ── Onglet Règles tarifaires ──────────────────────────────────────────────────
function RulesTab({ rules, onRefresh }: { rules: PricingRule[]; onRefresh: () => void }) {
  const [editing, setEditing] = useState<Partial<PricingRule> | null>(null);
  const [showForm, setShowForm] = useState(false);

  const openNew = () => { setEditing(null); setShowForm(true); };
  const openEdit = (r: PricingRule) => { setEditing(r); setShowForm(true); };

  const handleSave = async (data: Partial<PricingRule>) => {
    if (data.rule_id) {
      await api.put(`/admin/pricing-rules/${data.rule_id}`, data);
    } else {
      await api.post('/admin/pricing-rules', data);
    }
    setShowForm(false);
    onRefresh();
  };

  const handleDelete = (r: PricingRule) => {
    Alert.alert('Supprimer', `Supprimer la règle "${r.name}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        await api.delete(`/admin/pricing-rules/${r.rule_id}`);
        onRefresh();
      }},
    ]);
  };

  const handleToggle = async (r: PricingRule) => {
    await api.put(`/admin/pricing-rules/${r.rule_id}`, { active: !r.active });
    onRefresh();
  };

  return (
    <ScrollView contentContainerStyle={s.tabContent}>
      <SectionHeader title="Règles tarifaires" onAdd={openNew} />
      {rules.length === 0 && (
        <View style={s.empty}>
          <Ionicons name="options-outline" size={40} color={Colors.muted} />
          <Text style={s.emptyText}>Aucune règle configurée</Text>
          <Text style={s.emptySubText}>Sans règle active, aucun frais n'est prélevé.</Text>
        </View>
      )}
      {rules.map(r => (
        <View key={r.rule_id} style={[s.card, !r.active && s.cardInactive]} testID={`rule-card-${r.rule_id}`}>
          <View style={s.cardHeader}>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={s.cardTitleRow}>
                <View style={[s.activeDot, { backgroundColor: r.active ? Colors.success : Colors.muted }]} />
                <Text style={s.cardTitle}>{r.name}</Text>
              </View>
              <View style={s.typeBadge}><Text style={s.typeBadgeText}>{r.product_type}</Text></View>
            </View>
            <View style={s.cardActions}>
              <TouchableOpacity onPress={() => handleToggle(r)} style={s.iconBtn} testID={`toggle-rule-${r.rule_id}`}>
                <Ionicons name={r.active ? 'pause-circle-outline' : 'play-circle-outline'} size={22} color={r.active ? Colors.warning : Colors.success} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openEdit(r)} style={s.iconBtn} testID={`edit-rule-${r.rule_id}`}>
                <Ionicons name="pencil-outline" size={20} color={Colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDelete(r)} style={s.iconBtn} testID={`delete-rule-${r.rule_id}`}>
                <Ionicons name="trash-outline" size={20} color={Colors.destructive} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.feesGrid}>
            <FeeCell side="Payeur" label="Fixe" value={`+${r.payer_fixed_fee.toFixed(2)} €`} active={r.payer_fixed_fee > 0} />
            <FeeCell side="Payeur" label="%" value={`+${r.payer_percent_fee.toFixed(2)} %`} active={r.payer_percent_fee > 0} />
            <FeeCell side="Bénéficiaire" label="Fixe" value={`-${r.receiver_fixed_fee.toFixed(2)} €`} active={r.receiver_fixed_fee > 0} />
            <FeeCell side="Bénéficiaire" label="%" value={`-${r.receiver_percent_fee.toFixed(2)} %`} active={r.receiver_percent_fee > 0} />
          </View>
          {r.description ? <Text style={s.cardDesc}>{r.description}</Text> : null}
          <Text style={s.cardMeta}>Priorité : {r.priority}</Text>
        </View>
      ))}

      <Modal visible={showForm} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <RuleForm initial={editing} onSave={handleSave} onClose={() => setShowForm(false)} />
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

function FeeCell({ side, label, value, active }: { side: string; label: string; value: string; active: boolean }) {
  return (
    <View style={[s.feeCell, active && s.feeCellActive]}>
      <Text style={s.feeCellSide}>{side}</Text>
      <Text style={s.feeCellLabel}>{label}</Text>
      <Text style={[s.feeCellValue, active && { color: Colors.primary }]}>{value}</Text>
    </View>
  );
}

// ── Formulaire plan d'abonnement ──────────────────────────────────────────────
function PlanForm({ initial, onSave, onClose }: {
  initial: Partial<SubscriptionPlan> | null;
  onSave: (data: Partial<SubscriptionPlan>) => Promise<void>;
  onClose: () => void;
}) {
  const isNew = !initial?.plan_id;
  const [form, setForm] = useState<Partial<SubscriptionPlan>>({
    name: '', description: '', price: 0, duration_days: 30,
    exempt_payer_fixed: false, exempt_payer_percent: false,
    exempt_receiver_fixed: false, exempt_receiver_percent: false,
    active: true, priority: 0,
    ...initial,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof SubscriptionPlan, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name?.trim()) return Alert.alert('Erreur', 'Le nom est requis');
    setSaving(true);
    try { await onSave(form); }
    finally { setSaving(false); }
  };

  return (
    <View style={mf.modal}>
      <View style={mf.header}>
        <Text style={mf.title}>{isNew ? 'Nouveau plan' : 'Modifier le plan'}</Text>
        <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={Colors.muted} /></TouchableOpacity>
      </View>
      <ScrollView style={mf.body} keyboardShouldPersistTaps="handled">
        <Label>Nom *</Label>
        <TextInput style={mf.input} value={form.name} onChangeText={v => set('name', v)} placeholder="Ex: Premium Payeur" placeholderTextColor={Colors.muted} testID="plan-name-input" />
        <Label>Description</Label>
        <TextInput style={mf.input} value={form.description || ''} onChangeText={v => set('description', v)} placeholder="Optionnel" placeholderTextColor={Colors.muted} />
        <View style={mf.feeRow}>
          <View style={{ flex: 1 }}>
            <Label>Prix (€/période)</Label>
            <TextInput style={mf.input} keyboardType="decimal-pad" value={String(form.price ?? 0)}
              onChangeText={v => set('price', parseFloat(v) || 0)} testID="plan-price-input" />
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Label>Durée (jours, vide=∞)</Label>
            <TextInput style={mf.input} keyboardType="number-pad"
              value={form.duration_days != null ? String(form.duration_days) : ''}
              onChangeText={v => set('duration_days', v ? parseInt(v) : null)} testID="plan-duration-input" />
          </View>
        </View>

        <Text style={mf.groupTitle}>Exemptions accordées</Text>
        <Text style={mf.groupSub}>Les frais cochés seront supprimés pour les abonnés de ce plan.</Text>
        {([
          ['exempt_payer_fixed',    'Payeur — Frais fixe'],
          ['exempt_payer_percent',  'Payeur — Frais %'],
          ['exempt_receiver_fixed',   'Bénéficiaire — Frais fixe'],
          ['exempt_receiver_percent', 'Bénéficiaire — Frais %'],
        ] as [keyof SubscriptionPlan, string][]).map(([key, label]) => (
          <View key={key} style={mf.exemptRow}>
            <Text style={mf.exemptLabel}>{label}</Text>
            <Switch value={!!form[key]} onValueChange={v => set(key, v)}
              trackColor={{ true: Colors.primary }} thumbColor="#fff" testID={`plan-${key}-switch`} />
          </View>
        ))}

        <View style={mf.switchRow}>
          <View style={{ flex: 1 }}>
            <Label>Priorité</Label>
            <TextInput style={mf.input} keyboardType="number-pad" value={String(form.priority ?? 0)}
              onChangeText={v => set('priority', parseInt(v) || 0)} />
          </View>
          <View style={mf.switchBlock}>
            <Label>Actif</Label>
            <Switch value={form.active} onValueChange={v => set('active', v)}
              trackColor={{ true: Colors.primary }} thumbColor="#fff" testID="plan-active-switch" />
          </View>
        </View>
      </ScrollView>

      <TouchableOpacity style={[mf.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving} testID="save-plan-btn">
        {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={mf.saveBtnText}>Enregistrer</Text>}
      </TouchableOpacity>
    </View>
  );
}

// ── Onglet Abonnements ────────────────────────────────────────────────────────
function PlansTab({ plans, onRefresh }: { plans: SubscriptionPlan[]; onRefresh: () => void }) {
  const [editing, setEditing] = useState<Partial<SubscriptionPlan> | null>(null);
  const [showForm, setShowForm] = useState(false);

  const openNew = () => { setEditing(null); setShowForm(true); };
  const openEdit = (p: SubscriptionPlan) => { setEditing(p); setShowForm(true); };

  const handleSave = async (data: Partial<SubscriptionPlan>) => {
    if (data.plan_id) {
      await api.put(`/admin/subscription-plans/${data.plan_id}`, data);
    } else {
      await api.post('/admin/subscription-plans', data);
    }
    setShowForm(false);
    onRefresh();
  };

  const handleDelete = (p: SubscriptionPlan) => {
    Alert.alert('Supprimer', `Supprimer le plan "${p.name}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        await api.delete(`/admin/subscription-plans/${p.plan_id}`);
        onRefresh();
      }},
    ]);
  };

  const handleToggle = async (p: SubscriptionPlan) => {
    await api.put(`/admin/subscription-plans/${p.plan_id}`, { active: !p.active });
    onRefresh();
  };

  return (
    <ScrollView contentContainerStyle={s.tabContent}>
      <SectionHeader title="Plans d'abonnement" onAdd={openNew} />
      {plans.length === 0 && (
        <View style={s.empty}>
          <Ionicons name="card-outline" size={40} color={Colors.muted} />
          <Text style={s.emptyText}>Aucun plan configuré</Text>
        </View>
      )}
      {plans.map(p => (
        <View key={p.plan_id} style={[s.card, !p.active && s.cardInactive]} testID={`plan-card-${p.plan_id}`}>
          <View style={s.cardHeader}>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={s.cardTitleRow}>
                <View style={[s.activeDot, { backgroundColor: p.active ? Colors.success : Colors.muted }]} />
                <Text style={s.cardTitle}>{p.name}</Text>
                <Text style={s.priceTag}>{p.price.toFixed(2)} €</Text>
              </View>
              {p.duration_days
                ? <Text style={s.cardMeta}>Durée : {p.duration_days} jours</Text>
                : <Text style={s.cardMeta}>Durée : illimitée</Text>
              }
            </View>
            <View style={s.cardActions}>
              <TouchableOpacity onPress={() => handleToggle(p)} style={s.iconBtn} testID={`toggle-plan-${p.plan_id}`}>
                <Ionicons name={p.active ? 'pause-circle-outline' : 'play-circle-outline'} size={22} color={p.active ? Colors.warning : Colors.success} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openEdit(p)} style={s.iconBtn} testID={`edit-plan-${p.plan_id}`}>
                <Ionicons name="pencil-outline" size={20} color={Colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDelete(p)} style={s.iconBtn} testID={`delete-plan-${p.plan_id}`}>
                <Ionicons name="trash-outline" size={20} color={Colors.destructive} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.exemptBadges}>
            <ExemptBadge label="Payeur fixe ✓"   active={p.exempt_payer_fixed} />
            <ExemptBadge label="Payeur % ✓"       active={p.exempt_payer_percent} />
            <ExemptBadge label="Bénéf. fixe ✓"   active={p.exempt_receiver_fixed} />
            <ExemptBadge label="Bénéf. % ✓"       active={p.exempt_receiver_percent} />
            {!p.exempt_payer_fixed && !p.exempt_payer_percent && !p.exempt_receiver_fixed && !p.exempt_receiver_percent && (
              <Text style={s.noExempt}>Aucune exemption</Text>
            )}
          </View>
          {p.description ? <Text style={s.cardDesc}>{p.description}</Text> : null}
        </View>
      ))}

      <Modal visible={showForm} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <PlanForm initial={editing} onSave={handleSave} onClose={() => setShowForm(false)} />
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

// ── Onglet Paiements ──────────────────────────────────────────────────────────
function PaymentsTab({ payments }: { payments: any[] }) {
  const STATUS_COLOR: Record<string, string> = {
    succeeded: Colors.success, pending: Colors.warning,
    failed: Colors.destructive, cancelled: Colors.muted,
  };
  return (
    <ScrollView contentContainerStyle={s.tabContent}>
      <Text style={s.tabSectionTitle}>Paiements récents ({payments.length})</Text>
      {payments.slice(0, 50).map((p, i) => (
        <View key={p.payment_id} style={s.payRow} testID={`payment-row-${p.payment_id}`}>
          <View style={{ flex: 1 }}>
            <Text style={s.payType}>{p.product_type}</Text>
            <Text style={s.payParties} numberOfLines={1}>
              {p.payer_name || p.payer_user_id?.slice(0, 10)} → {p.receiver_name || p.receiver_user_id?.slice(0, 10)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text style={s.payAmount}>{p.payer_total_amount?.toFixed(2)} €</Text>
            <View style={[s.statusBadge, { backgroundColor: STATUS_COLOR[p.status] + '22' }]}>
              <Text style={[s.statusText, { color: STATUS_COLOR[p.status] }]}>{p.status}</Text>
            </View>
          </View>
        </View>
      ))}
      {payments.length === 0 && (
        <View style={s.empty}>
          <Ionicons name="receipt-outline" size={40} color={Colors.muted} />
          <Text style={s.emptyText}>Aucun paiement</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ── Onglet Configuration des réservations ────────────────────────────────────
function BookingConfigTab() {
  const [cfg, setCfg] = useState({ enable_manual_approval_for_services: false, enable_pay_later_for_services: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    api.get<typeof cfg>('/admin/app-config')
      .then(data => { setCfg(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const toggle = async (key: keyof typeof cfg) => {
    setSaving(key);
    const newVal = !cfg[key];
    try {
      await api.put('/admin/app-config', { [key]: newVal });
      setCfg(prev => ({ ...prev, [key]: newVal }));
      // Invalider le cache frontend
      const { invalidateBookingConfig } = await import('../../lib/useBookingConfig');
      invalidateBookingConfig();
      Alert.alert('Sauvegardé', `Configuration mise à jour.`);
    } catch {
      Alert.alert('Erreur', 'Impossible de sauvegarder');
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <View style={s.center}><ActivityIndicator color={Colors.primary} /></View>;

  const rows: { key: keyof typeof cfg; label: string; help: string; icon: string; color: string }[] = [
    {
      key: 'enable_manual_approval_for_services',
      label: 'Validation manuelle',
      help: "Permet aux propriétaires de services d'accepter ou refuser les demandes avant confirmation.",
      icon: 'hand-left-outline',
      color: '#FF9500',
    },
    {
      key: 'enable_pay_later_for_services',
      label: 'Paiement différé',
      help: "Permet de réserver un créneau sans payer immédiatement. Le créneau peut être bloqué temporairement en attente de paiement.",
      icon: 'time-outline',
      color: '#0A84FF',
    },
  ];

  return (
    <ScrollView contentContainerStyle={s.tabContent}>
      <Text style={s.tabSectionTitle}>Configuration des réservations</Text>

      {/* Bandeau MVP */}
      <View style={bc.mvpBanner}>
        <Ionicons name="flash" size={16} color="#fff" />
        <View style={{ flex: 1 }}>
          <Text style={bc.mvpTitle}>Mode MVP actif</Text>
          <Text style={bc.mvpSub}>
            Par défaut : réservation directe · paiement immédiat.
            Activez les options ci-dessous pour débloquer des fonctionnalités avancées.
          </Text>
        </View>
      </View>

      {rows.map(row => (
        <View key={row.key} style={bc.row} testID={`config-row-${row.key}`}>
          <View style={[bc.iconWrap, { backgroundColor: row.color + '18' }]}>
            <Ionicons name={row.icon as any} size={22} color={row.color} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={bc.rowLabel}>{row.label}</Text>
            <Text style={bc.rowHelp}>{row.help}</Text>
          </View>
          <View style={{ alignItems: 'center', gap: 4 }}>
            {saving === row.key
              ? <ActivityIndicator size="small" color={row.color} />
              : <Switch
                  value={cfg[row.key]}
                  onValueChange={() => toggle(row.key)}
                  trackColor={{ true: row.color, false: Colors.border }}
                  thumbColor="#fff"
                  testID={`toggle-${row.key}`}
                />
            }
            <Text style={[bc.rowStatus, { color: cfg[row.key] ? row.color : Colors.muted }]}>
              {cfg[row.key] ? 'Activé' : 'Désactivé'}
            </Text>
          </View>
        </View>
      ))}

      <View style={bc.footer}>
        <Ionicons name="information-circle-outline" size={14} color={Colors.muted} />
        <Text style={bc.footerText}>
          Ces paramètres s'appliquent à tous les nouveaux services et réservations.
          Les services existants sont maintenus mais les fonctionnalités désactivées sont ignorées lors des réservations.
        </Text>
      </View>
    </ScrollView>
  );
}

// ── Label helper ──────────────────────────────────────────────────────────────
function Label({ children }: { children: string }) {
  return <Text style={mf.label}>{children}</Text>;
}

// ── Écran principal ───────────────────────────────────────────────────────────
export default function AdminScreen() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('stats');
  const [stats, setStats] = useState<Stats | null>(null);
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ALL hooks must be defined before any conditional returns (Rules of Hooks)
  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const [s, r, p, pay] = await Promise.all([
        api.get<Stats>('/admin/stats'),
        api.get<PricingRule[]>('/admin/pricing-rules'),
        api.get<SubscriptionPlan[]>('/admin/subscription-plans'),
        api.get<any[]>('/admin/payments').catch(() => []),
      ]);
      setStats(s); setRules(r); setPlans(p); setPayments(pay);
    } catch (e) {
      Alert.alert('Erreur', 'Impossible de charger les données admin');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    if (!authLoading && user?.role === 'admin') {
      load();
    }
  }, [load, authLoading, user]));

  // Use useEffect for navigation to avoid "navigate before mounting" error
  React.useEffect(() => {
    if (!authLoading && user?.role !== 'admin') {
      router.back();
    }
  }, [authLoading, user, router]);

  if (authLoading) return <View style={{ flex: 1, backgroundColor: Colors.background }}><ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 100 }} /></View>;
  if (!user || user.role !== 'admin') return null;

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'stats',    label: 'Aperçu',        icon: 'bar-chart-outline' },
    { key: 'rules',    label: 'Règles',        icon: 'options-outline' },
    { key: 'plans',    label: 'Abonnements',   icon: 'card-outline' },
    { key: 'payments', label: 'Paiements',     icon: 'receipt-outline' },
    { key: 'booking',  label: 'Réservations',  icon: 'settings-outline' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.header }}>
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="admin-back-btn">
            <Ionicons name="chevron-back" size={22} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Dashboard Admin</Text>
          <View style={{ width: 38 }} />
        </View>

        {/* Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar}>
          {TABS.map(t => (
            <TouchableOpacity key={t.key} style={[s.tabItem, tab === t.key && s.tabItemActive]}
              onPress={() => setTab(t.key)} testID={`admin-tab-${t.key}`}>
              <Ionicons name={t.icon as any} size={16} color={tab === t.key ? Colors.primary : Colors.muted} />
              <Text style={[s.tabLabel, tab === t.key && s.tabLabelActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <View style={{ flex: 1 }}>
          {tab === 'stats'    && <StatsTab stats={stats} />}
          {tab === 'rules'    && <RulesTab rules={rules} onRefresh={() => load(true)} />}
          {tab === 'plans'    && <PlansTab plans={plans} onRefresh={() => load(true)} />}
          {tab === 'payments' && <PaymentsTab payments={payments} />}
          {tab === 'booking'  && <BookingConfigTab />}
        </View>
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  headerRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  backBtn:        { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerTitle:    { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: Colors.primary },
  tabBar:         { borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabItem:        { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  tabItemActive:  { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabLabel:       { fontSize: 13, color: Colors.muted },
  tabLabelActive: { color: Colors.primary, fontWeight: '600' },
  tabContent:     { padding: 16, paddingBottom: 40, gap: 10 },
  tabSectionTitle:{ fontSize: 13, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center' },

  statsGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard:     { flex: 1, minWidth: 140, backgroundColor: Colors.card, borderRadius: 12, padding: 16, gap: 4, borderWidth: 1, borderColor: Colors.border },
  statValue:    { fontSize: 22, fontWeight: '800', color: Colors.primary },
  statLabel:    { fontSize: 12, color: Colors.foreground, fontWeight: '600' },
  statSub:      { fontSize: 11, color: Colors.muted },

  sectionHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle:   { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  addBtn:         { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  addBtnText:     { fontSize: 13, fontWeight: '700', color: Colors.background },

  card:           { backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: Colors.border },
  cardInactive:   { opacity: 0.5 },
  cardHeader:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitleRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  cardTitle:      { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  cardDesc:       { fontSize: 12, color: Colors.muted },
  cardMeta:       { fontSize: 11, color: Colors.muted },
  cardActions:    { flexDirection: 'row', gap: 4 },
  iconBtn:        { padding: 6 },
  activeDot:      { width: 8, height: 8, borderRadius: 4 },
  typeBadge:      { alignSelf: 'flex-start', backgroundColor: Colors.primary + '22', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  typeBadgeText:  { fontSize: 11, color: Colors.primary, fontWeight: '600' },
  priceTag:       { fontSize: 14, fontWeight: '700', color: Colors.success },

  feesGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  feeCell:        { flex: 1, minWidth: '45%', backgroundColor: Colors.background, borderRadius: 8, padding: 8, borderWidth: 1, borderColor: Colors.border, gap: 2 },
  feeCellActive:  { borderColor: Colors.primary + '55' },
  feeCellSide:    { fontSize: 10, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  feeCellLabel:   { fontSize: 11, color: Colors.muted },
  feeCellValue:   { fontSize: 14, fontWeight: '700', color: Colors.foreground },

  exemptBadges:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  exemptBadge:    { backgroundColor: Colors.success + '22', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: Colors.success + '44' },
  exemptBadgeText:{ fontSize: 11, color: Colors.success, fontWeight: '600' },
  noExempt:       { fontSize: 12, color: Colors.muted, fontStyle: 'italic' },

  payRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  payType:      { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  payParties:   { fontSize: 11, color: Colors.muted },
  payAmount:    { fontSize: 14, fontWeight: '700', color: Colors.primary },
  statusBadge:  { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusText:   { fontSize: 11, fontWeight: '700' },

  empty:       { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText:   { fontSize: 15, fontWeight: '600', color: Colors.muted },
  emptySubText:{ fontSize: 12, color: Colors.muted, textAlign: 'center' },
});

const bc = StyleSheet.create({
  mvpBanner:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: Colors.primary, borderRadius: 12, padding: 14, marginBottom: 8 },
  mvpTitle:    { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 2 },
  mvpSub:      { fontSize: 12, color: 'rgba(255,255,255,0.8)', lineHeight: 17 },
  row:         { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border },
  iconWrap:    { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowLabel:    { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  rowHelp:     { fontSize: 12, color: Colors.muted, lineHeight: 17 },
  rowStatus:   { fontSize: 11, fontWeight: '600' },
  footer:      { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingTop: 8, paddingHorizontal: 4 },
  footerText:  { flex: 1, fontSize: 11, color: Colors.muted, lineHeight: 16 },
});

const mf = StyleSheet.create({
  modal:      { flex: 1, backgroundColor: Colors.background },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  title:      { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  body:       { flex: 1, padding: 16 },
  label:      { fontSize: 12, color: Colors.muted, fontWeight: '600', marginBottom: 4, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  input:      { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: Colors.foreground, fontSize: 15 },
  feeRow:     { flexDirection: 'row' },
  groupTitle: { fontSize: 14, fontWeight: '700', color: Colors.primary, marginTop: 20, marginBottom: 4 },
  groupSub:   { fontSize: 12, color: Colors.muted, marginBottom: 4 },
  switchRow:  { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: 12 },
  switchBlock:{ alignItems: 'flex-end', paddingBottom: 6, gap: 4 },
  exemptRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  exemptLabel:{ fontSize: 14, color: Colors.foreground, flex: 1 },
  chipRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:       { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  chipActive: { backgroundColor: Colors.primary + '22', borderColor: Colors.primary },
  chipText:   { fontSize: 12, color: Colors.muted },
  chipTextActive: { color: Colors.primary, fontWeight: '600' },
  saveBtn:    { margin: 16, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveBtnText:{ fontSize: 16, fontWeight: '700', color: Colors.background },
});
