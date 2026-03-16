import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, ActivityIndicator, FlatList, Alert, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { api } from '../lib/api';
import { searchPlaces, getPlaceDetails, type PlaceSuggestion } from '../services/googlePlacesService';
import { useGuardedRouter } from '../hooks/useGuardedRouter';

// ── Available icons ─────────────────────────────────────────────────────────
const ICONS = [
  { key: 'home-outline',       label: 'Domicile' },
  { key: 'briefcase-outline',  label: 'Travail'  },
  { key: 'fitness-outline',    label: 'Sport'    },
  { key: 'school-outline',     label: 'École'    },
  { key: 'restaurant-outline', label: 'Resto'    },
  { key: 'location-outline',   label: 'Autre'    },
] as const;

type IconKey = typeof ICONS[number]['key'];

interface SavedAddress {
  address_id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  icon: IconKey;
}

interface AddressFormState {
  label: string;
  address: string;
  lat: number | null;
  lng: number | null;
  icon: IconKey;
}

const EMPTY_FORM: AddressFormState = { label: '', address: '', lat: null, lng: null, icon: 'location-outline' };

export default function ManageAddressesScreen() {
  const router = useGuardedRouter();
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form (add/edit)
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AddressFormState>(EMPTY_FORM);

  // Address search inside form
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadAddresses(); }, []);

  const loadAddresses = async () => {
    setLoading(true);
    try {
      const data = await api.get('/addresses');
      setAddresses(data || []);
    } catch {}
    setLoading(false);
  };

  // ── Search ──────────────────────────────────────────────────────────────
  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (text.length < 2) { setSearchResults([]); setShowResults(false); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchPlaces(text);
        setSearchResults(results);
        setShowResults(results.length > 0);
      } catch {}
      setSearching(false);
    }, 400);
  };

  const handleSelectResult = async (result: PlaceSuggestion) => {
    setSearchQuery('');
    setSearchResults([]);
    setShowResults(false);
    Keyboard.dismiss();
    try {
      const details = await getPlaceDetails(result.place_id);
      if (details) {
        setForm(f => ({
          ...f,
          address: details.address || result.description,
          lat: details.lat,
          lng: details.lng,
        }));
      }
    } catch {}
  };

  // ── Open Add form ────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSearchQuery('');
    setShowForm(true);
  };

  // ── Open Edit form ───────────────────────────────────────────────────────
  const openEdit = (addr: SavedAddress) => {
    setEditingId(addr.address_id);
    setForm({ label: addr.label, address: addr.address, lat: addr.lat, lng: addr.lng, icon: addr.icon });
    setSearchQuery('');
    setShowForm(true);
  };

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.label.trim() || !form.address || form.lat === null || form.lng === null) {
      Alert.alert('Champs manquants', 'Renseignez un nom et une adresse valide.');
      return;
    }
    setSaving(true);
    try {
      const payload = { label: form.label.trim(), address: form.address, lat: form.lat, lng: form.lng, icon: form.icon };
      if (editingId) {
        const updated = await api.put(`/addresses/${editingId}`, payload);
        setAddresses(prev => prev.map(a => a.address_id === editingId ? updated : a));
      } else {
        const created = await api.post('/addresses', payload);
        setAddresses(prev => [...prev, created]);
      }
      setShowForm(false);
    } catch {
      Alert.alert('Erreur', "Impossible d'enregistrer l'adresse.");
    }
    setSaving(false);
  };

  // ── Delete ───────────────────────────────────────────────────────────────
  const handleDelete = (addr: SavedAddress) => {
    Alert.alert(
      'Supprimer l\'adresse',
      `Supprimer "${addr.label}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/addresses/${addr.address_id}`);
              setAddresses(prev => prev.filter(a => a.address_id !== addr.address_id));
            } catch {
              Alert.alert('Erreur', 'Impossible de supprimer.');
            }
          },
        },
      ],
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={s.safeTop}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => showForm ? setShowForm(false) : router.back()} style={s.headerBack} testID="back-btn">
            <Ionicons name="chevron-back" size={24} color={Colors.foreground} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{showForm ? (editingId ? 'Modifier' : 'Nouvelle adresse') : 'Mes adresses'}</Text>
          {showForm ? (
            <TouchableOpacity onPress={handleSave} style={s.headerAction} disabled={saving} testID="save-address-btn">
              {saving ? <ActivityIndicator size="small" color={Colors.primary} /> : <Text style={s.headerActionTxt}>Enregistrer</Text>}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={openAdd} style={s.headerAction} testID="add-address-btn">
              <Ionicons name="add" size={24} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>

      {/* ── LIST VIEW ─────────────────────────────────────────────────── */}
      {!showForm && (
        <ScrollView contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
          {loading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
          ) : addresses.length === 0 ? (
            <View style={s.emptyState}>
              <Ionicons name="location-outline" size={52} color={Colors.muted} />
              <Text style={s.emptyTitle}>Aucune adresse enregistrée</Text>
              <Text style={s.emptySub}>Ajoutez vos adresses favorites pour les retrouver facilement.</Text>
              <TouchableOpacity style={s.emptyBtn} onPress={openAdd} testID="empty-add-btn">
                <Ionicons name="add" size={18} color={Colors.background} />
                <Text style={s.emptyBtnTxt}>Ajouter une adresse</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={s.sectionLabel}>Adresses enregistrées</Text>
              {addresses.map(addr => (
                <View key={addr.address_id} style={s.addrCard} testID={`addr-card-${addr.address_id}`}>
                  <View style={s.addrIcon}>
                    <Ionicons name={addr.icon as any} size={22} color={Colors.primary} />
                  </View>
                  <View style={s.addrInfo}>
                    <Text style={s.addrLabel}>{addr.label}</Text>
                    <Text style={s.addrText} numberOfLines={1}>{addr.address}</Text>
                  </View>
                  <View style={s.addrActions}>
                    <TouchableOpacity onPress={() => openEdit(addr)} style={s.addrBtn} testID={`edit-${addr.address_id}`}>
                      <Ionicons name="pencil-outline" size={18} color={Colors.muted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(addr)} style={s.addrBtn} testID={`delete-${addr.address_id}`}>
                      <Ionicons name="trash-outline" size={18} color="#FF453A" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* ── FORM VIEW ─────────────────────────────────────────────────── */}
      {showForm && (
        <ScrollView contentContainerStyle={s.formContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Nom */}
          <Text style={s.fieldLabel}>Nom de l'adresse *</Text>
          <TextInput
            style={s.input}
            placeholder="Ex : Domicile, Salle de sport…"
            placeholderTextColor={Colors.muted}
            value={form.label}
            onChangeText={v => setForm(f => ({ ...f, label: v }))}
            testID="address-label-input"
          />

          {/* Icône */}
          <Text style={s.fieldLabel}>Icône</Text>
          <View style={s.iconsRow}>
            {ICONS.map(ic => (
              <TouchableOpacity
                key={ic.key}
                style={[s.iconChip, form.icon === ic.key && s.iconChipActive]}
                onPress={() => setForm(f => ({ ...f, icon: ic.key }))}
                testID={`icon-${ic.key}`}
              >
                <Ionicons name={ic.key as any} size={20} color={form.icon === ic.key ? Colors.primary : Colors.muted} />
                <Text style={[s.iconLabel, form.icon === ic.key && { color: Colors.primary }]}>{ic.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Recherche adresse */}
          <Text style={s.fieldLabel}>Adresse *</Text>
          <View style={s.searchWrap}>
            <View style={s.searchRow}>
              <Ionicons name="search" size={16} color={Colors.muted} />
              <TextInput
                style={s.searchInput}
                placeholder="Rechercher une adresse…"
                placeholderTextColor={Colors.muted}
                value={searchQuery || form.address}
                onChangeText={v => {
                  setSearchQuery(v);
                  setForm(f => ({ ...f, address: v, lat: null, lng: null }));
                  handleSearchChange(v);
                }}
                testID="address-search-input"
              />
              {searching && <ActivityIndicator size="small" color={Colors.primary} />}
              {(searchQuery || form.address) && (
                <TouchableOpacity onPress={() => { setSearchQuery(''); setForm(f => ({ ...f, address: '', lat: null, lng: null })); setShowResults(false); }}>
                  <Ionicons name="close-circle" size={16} color={Colors.muted} />
                </TouchableOpacity>
              )}
            </View>
            {showResults && (
              <FlatList
                data={searchResults}
                keyExtractor={i => i.place_id}
                scrollEnabled={false}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity style={s.resultItem} onPress={() => handleSelectResult(item)} testID={`result-${item.place_id}`}>
                    <Ionicons name="location-outline" size={14} color={Colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.resultMain} numberOfLines={1}>{item.main_text}</Text>
                      {item.secondary_text ? <Text style={s.resultSub} numberOfLines={1}>{item.secondary_text}</Text> : null}
                    </View>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>

          {/* Confirmation de sélection */}
          {form.lat !== null && form.address && (
            <View style={s.selectedAddr}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.primary} />
              <Text style={s.selectedAddrTxt} numberOfLines={2}>{form.address}</Text>
            </View>
          )}

          {/* Bouton Enregistrer */}
          <TouchableOpacity
            style={[s.saveBtn, (saving || !form.label || !form.lat) && { opacity: 0.5 }]}
            onPress={handleSave}
            disabled={saving || !form.label.trim() || form.lat === null}
            testID="save-btn"
          >
            {saving
              ? <ActivityIndicator size="small" color={Colors.background} />
              : <Ionicons name="checkmark-circle" size={20} color={Colors.background} />
            }
            <Text style={s.saveBtnTxt}>{editingId ? 'Modifier' : 'Enregistrer'}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  safeTop: { backgroundColor: Colors.header },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.header,
  },
  headerBack: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: Colors.foreground, textAlign: 'center' },
  headerAction: { width: 90, alignItems: 'flex-end', justifyContent: 'center' },
  headerActionTxt: { fontSize: 15, fontWeight: '700', color: Colors.primary },

  listContent: { padding: Spacing.md, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: Colors.primary,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
  addrCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.card,
    borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  addrIcon: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: Colors.primary + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  addrInfo: { flex: 1 },
  addrLabel: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  addrText: { fontSize: 13, color: Colors.muted, marginTop: 2 },
  addrActions: { flexDirection: 'row', gap: 4 },
  addrBtn: { padding: 8 },

  emptyState: { alignItems: 'center', gap: 12, paddingTop: 60 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  emptySub: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20, maxWidth: 260 },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 100, paddingHorizontal: 20, paddingVertical: 12,
    marginTop: 8,
  },
  emptyBtnTxt: { fontSize: 14, fontWeight: '700', color: Colors.background },

  // Form
  formContent: { padding: Spacing.md, paddingBottom: 60 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 16 },
  input: {
    backgroundColor: Colors.card,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingVertical: 13,
    fontSize: 15, color: Colors.foreground,
  },
  iconsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconChip: {
    alignItems: 'center', gap: 4, padding: 10, borderRadius: 12,
    backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border,
    minWidth: 68,
  },
  iconChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '15' },
  iconLabel: { fontSize: 10, color: Colors.muted, fontWeight: '600' },

  searchWrap: { borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.card, paddingHorizontal: 12, paddingVertical: 12,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.foreground },
  resultItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.card,
  },
  resultMain: { fontSize: 13, color: Colors.foreground, fontWeight: '500' },
  resultSub: { fontSize: 11, color: Colors.muted, marginTop: 1 },

  selectedAddr: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: Colors.primary + '12',
    borderRadius: 10, padding: 10, marginTop: 8,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  selectedAddrTxt: { flex: 1, fontSize: 13, color: Colors.primary, fontWeight: '500' },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 100,
    paddingVertical: 14, marginTop: 28,
  },
  saveBtnTxt: { fontSize: 16, fontWeight: '700', color: Colors.background },
});
