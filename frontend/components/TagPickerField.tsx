/**
 * TagPickerField — composant partagé de sélection de tags avec modal + recherche.
 *
 * Utilisé dans :
 *  - Création produit (Step1TypeCategory) — filterCategoryId={form.category}
 *  - Création / édition SpotYou (create.tsx) — entityType="spotyou", showDomains
 *  - Création / édition Service (create-service.tsx) — entityType="service", showDomains
 *
 * Fonctionnalités :
 *  - Bouton trigger "Choisir des tags >" avec aperçu des tags sélectionnés (mini-pills)
 *  - Modal bottom sheet :
 *      · Champ de recherche (filtre catégories + tags en temps réel)
 *      · Catégories groupées avec code couleur
 *      · Compteur + bouton Effacer
 *  - Filtre domaine optionnel (spotyou / service) : chips au-dessus du trigger
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Modal, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { api } from '../lib/api';

/* ── Types ─────────────────────────────────────────────────────────────── */
interface TagItem     { tag_id: string; label_fr: string; label_en?: string }
interface CategoryItem { category_id: string; label_fr: string; label_en?: string; domain_id?: string; tags: TagItem[] }
interface DomainItem   { domain_id: string; label_fr?: string; name?: string; color?: string }

const flattenTags = (cats: CategoryItem[]) =>
  cats.flatMap(cat =>
    (cat.tags || []).map(t => ({ ...t, category_id: cat.category_id, category_name: cat.label_fr }))
  );

const mergeCategories = (base: CategoryItem[], extra: CategoryItem[]): CategoryItem[] => {
  const byId = new Map<string, CategoryItem>();
  base.forEach(cat => byId.set(cat.category_id, { ...cat, tags: [...(cat.tags || [])] }));
  extra.forEach(cat => {
    const current = byId.get(cat.category_id);
    if (!current) {
      byId.set(cat.category_id, { ...cat, tags: [...(cat.tags || [])] });
      return;
    }
    const seen = new Set((current.tags || []).map(t => t.tag_id));
    (cat.tags || []).forEach(t => {
      if (!seen.has(t.tag_id)) current.tags.push(t);
    });
  });
  return Array.from(byId.values());
};

/* ── Couleurs par catégorie (déterministe) ──────────────────────────────── */
const CAT_PALETTE = [
  '#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#EC4899','#06B6D4','#84CC16','#F97316','#6366F1',
];
const catColor = (id: string) => CAT_PALETTE[Math.abs(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % CAT_PALETTE.length];

/* ── Props ──────────────────────────────────────────────────────────────── */
interface TagPickerFieldProps {
  entityType?:      string;          // 'product' | 'service' | 'spotyou' | '' = toutes
  selectedTagIds:   string[];
  onChangeTagIds:   (ids: string[]) => void;
  filterCategoryId?: string;         // product : restreindre au tags d'une catégorie
  showDomains?:     boolean;         // afficher les chips domaine (service / spotyou)
  maxSelect?:       number;          // défaut: illimité
  accentColor?:     string;          // défaut: bleu
  label?:           string;
  hint?:            string;
  required?:        boolean;
  /** Callback appelé à chaque chargement : expose tous les tags (avec category_id) au parent */
  onTagsLoaded?:    (tags: { tag_id: string; label_fr: string; label_en?: string; category_id: string; category_name?: string }[]) => void;
  /** Callback appelé quand le domaine sélectionné change (showDomains uniquement) */
  onDomainChange?:  (domainId: string) => void;
  /** Domaine initial (utile en mode édition). */
  initialDomainId?: string | null;
  /** Map de labels résolus par le parent (source référentiel). */
  resolvedTagsMap?: Record<string, { label_fr: string; label_en?: string; category_id?: string }>;
}

export function TagPickerField({
  entityType = '', selectedTagIds, onChangeTagIds,
  filterCategoryId, showDomains = false,
  maxSelect, accentColor = '#3B82F6',
  label, hint, required, onTagsLoaded, onDomainChange,
  initialDomainId = null,
  resolvedTagsMap,
}: TagPickerFieldProps) {
  const [allCategories, setAllCategories] = useState<CategoryItem[]>([]);
  const [domains,       setDomains]       = useState<DomainItem[]>([]);
  const [domainId,      setDomainId]      = useState<string | null>(null);
  const [modalVisible,  setModalVisible]  = useState(false);
  const [query,         setQuery]         = useState('');
  const [loading,       setLoading]       = useState(false);

  /* ── Fetch catégories ────────────────────────────────────────────────── */
  useEffect(() => {
    setLoading(true);
    const qs = [
      entityType ? `entity_type=${entityType}` : '',
      domainId   ? `domain_id=${domainId}`      : '',
    ].filter(Boolean).join('&');
    const url = `/tags/categories${qs ? `?${qs}` : ''}`;
    api.get(url)
      .then((data: CategoryItem[]) => {
        const cats = data || [];
        const selectedSet = new Set(selectedTagIds);
        const hasAllSelected = selectedTagIds.length === 0 || selectedTagIds.every(id =>
          cats.some(cat => (cat.tags || []).some(tag => tag.tag_id === id))
        );

        if (entityType && selectedSet.size > 0 && !hasAllSelected) {
          const fallbackQs = [domainId ? `domain_id=${domainId}` : ''].filter(Boolean).join('&');
          const fallbackUrl = `/tags/categories${fallbackQs ? `?${fallbackQs}` : ''}`;
          api.get(fallbackUrl)
            .then((fallbackData: CategoryItem[]) => {
              const selectedOnly = (fallbackData || [])
                .map(cat => ({ ...cat, tags: (cat.tags || []).filter(tag => selectedSet.has(tag.tag_id)) }))
                .filter(cat => cat.tags.length > 0);
              const merged = mergeCategories(cats, selectedOnly);
              setAllCategories(merged);
              onTagsLoaded?.(flattenTags(merged));
            })
            .catch(() => {
              setAllCategories(cats);
              onTagsLoaded?.(flattenTags(cats));
            })
            .finally(() => setLoading(false));
          return;
        }

        setAllCategories(cats);
        onTagsLoaded?.(flattenTags(cats));
      })
      .catch(() => setAllCategories([]))
      .finally(() => setLoading(false));
  }, [entityType, domainId, selectedTagIds]);

  /* ── Fetch domaines (si showDomains) ────────────────────────────────── */
  useEffect(() => {
    if (!showDomains) return;
    api.get('/domains')
      .then((data: DomainItem[]) => {
        const sorted = [...(data || [])].sort((a, b) =>
          a.domain_id === 'dom_sport' ? -1 : b.domain_id === 'dom_sport' ? 1 : 0
        );
        setDomains(sorted);
        if (!domainId && sorted.length > 0) {
          const wanted = initialDomainId && sorted.some(d => d.domain_id === initialDomainId)
            ? initialDomainId
            : sorted[0].domain_id;
          setDomainId(wanted);
          onDomainChange?.(wanted);
        }
      })
      .catch(() => {});
  }, [showDomains, initialDomainId]);

  // Garde le domaine interne synchronisé avec le domaine fourni par le parent
  // (important en mode édition quand initialDomainId arrive après le 1er render).
  useEffect(() => {
    if (!showDomains || !initialDomainId || domains.length === 0) return;
    if (!domains.some(d => d.domain_id === initialDomainId)) return;
    if (domainId === initialDomainId) return;
    setDomainId(initialDomainId);
    onDomainChange?.(initialDomainId);
  }, [showDomains, initialDomainId, domains, domainId, onDomainChange]);

  /* ── Filtrage dans le modal ──────────────────────────────────────────── */
  const filteredCategories = useMemo(() => {
    // Déduplique les catégories par category_id (évite les doublons quand entityType='')
    const seenCats = new Set<string>();
    let cats = allCategories.filter(c => {
      if (seenCats.has(c.category_id)) return false;
      seenCats.add(c.category_id);
      return true;
    });
    if (filterCategoryId) cats = cats.filter(c => c.category_id === filterCategoryId);
    const q = query.trim().toLowerCase();
    if (!q) return cats.filter(c => (c.tags || []).length > 0);
    return cats
      .map(cat => {
        const catNameMatches = (cat.label_fr ?? '').toLowerCase().includes(q);
        return {
          ...cat,
          // Si le nom de catégorie matche → afficher tous ses tags
          // Sinon → filtrer uniquement les tags qui matchent
          tags: catNameMatches
            ? (cat.tags || [])
            : (cat.tags || []).filter(t =>
                (t.label_fr ?? '').toLowerCase().includes(q) ||
                (t.label_en ?? '').toLowerCase().includes(q)
              ),
        };
      })
      // N'afficher la catégorie que si elle a au moins 1 tag sélectionnable
      .filter(cat => cat.tags.length > 0);
  }, [allCategories, query, filterCategoryId]);

  /* ── Toggle tag ─────────────────────────────────────────────────────── */
  const toggleTag = (id: string) => {
    if (selectedTagIds.includes(id)) {
      onChangeTagIds(selectedTagIds.filter(t => t !== id));
    } else if (!maxSelect || selectedTagIds.length < maxSelect) {
      onChangeTagIds([...selectedTagIds, id]);
    }
  };

  /* ── Tags sélectionnés (pour aperçu pills) ──────────────────────────── */
  const allTags = useMemo(() => {
    // Déduplique les tags par tag_id (évite les pills multiples quand entityType='')
    const seen = new Set<string>();
    return allCategories.flatMap(c => c.tags || []).filter(t => {
      if (seen.has(t.tag_id)) return false;
      seen.add(t.tag_id);
      return true;
    });
  }, [allCategories]);
  const selTagObjs = useMemo(() => {
    const tagsById = new Map<string, TagItem & { category_id?: string }>();
    allTags.forEach(t => tagsById.set(t.tag_id, t));
    selectedTagIds.forEach(id => {
      if (!tagsById.has(id) && resolvedTagsMap?.[id]) {
        const rt = resolvedTagsMap[id];
        tagsById.set(id, {
          tag_id: id,
          label_fr: rt.label_fr || id,
          label_en: rt.label_en,
          category_id: rt.category_id,
        });
      }
    });
    return selectedTagIds.map(id => tagsById.get(id)).filter(Boolean) as (TagItem & { category_id?: string })[];
  }, [allTags, selectedTagIds, resolvedTagsMap]);
  const count      = selectedTagIds.length;

  /* ── Couleur domaine ─────────────────────────────────────────────────── */
  const domainColor = (d: DomainItem): string => d.color || '#3B82F6';

  /* ────────────────────────────────────────────────────────────────────── */
  return (
    <View style={t.wrap}>
      {label && (
        <Text style={t.fieldLabel}>
          {label}{required && <Text style={{ color: '#EF4444' }}> *</Text>}
        </Text>
      )}

      {/* ── Chips domaine (spotyou / service) ──────────────────────────── */}
      {showDomains && domains.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
          <View style={t.domainsRow}>
            {domains.map(d => {
              const sel = domainId === d.domain_id;
              const col = domainColor(d);
              return (
                <TouchableOpacity
                  key={d.domain_id}
                  style={[t.domainPill, sel && { backgroundColor: col + '22', borderColor: col }]}
                  onPress={() => {
                    const next = sel ? null : d.domain_id;
                    setDomainId(next);
                    if (next) onDomainChange?.(next);
                  }}
                  testID={`domain-${d.domain_id}`}
                >
                  <Text style={[t.domainPillText, sel && { color: col, fontWeight: '700' }]}>
                    {d.label_fr || d.name || d.domain_id}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* ── Pills aperçu des tags sélectionnés ─────────────────────────── */}
      {selTagObjs.length > 0 && (
        <View style={t.previewRow}>
          {selTagObjs.map(tg => (
            <TouchableOpacity
              key={tg.tag_id}
              style={[t.previewPill, { borderColor: accentColor, backgroundColor: accentColor + '15' }]}
              onPress={() => toggleTag(tg.tag_id)}
              testID={`tag-preview-${tg.tag_id}`}
            >
              <Text style={[t.previewPillText, { color: accentColor }]}>{tg.label_fr}</Text>
              <Ionicons name="close-circle" size={13} color={accentColor} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Bouton trigger ─────────────────────────────────────────────── */}
      <TouchableOpacity
        style={[t.trigger, count > 0 && { borderColor: accentColor + '60' }]}
        onPress={() => setModalVisible(true)}
        testID="open-tag-picker-btn"
        activeOpacity={0.75}
      >
        <Ionicons name="pricetag-outline" size={16} color={count > 0 ? accentColor : Colors.muted} />
        <Text style={[t.triggerText, count > 0 && { color: accentColor }]}>
          {count > 0
            ? `${count} tag${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`
            : 'Choisir des tags'}
        </Text>
        {maxSelect && (
          <Text style={[t.triggerCount, count === maxSelect && { color: accentColor }]}>
            {count}/{maxSelect}
          </Text>
        )}
        <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
      </TouchableOpacity>

      {hint && <Text style={t.hint}>{hint}</Text>}

      {/* ══ MODAL ═══════════════════════════════════════════════════════════ */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => { setModalVisible(false); setQuery(''); }}
      >
        <View style={t.overlay}>
          {/* Backdrop */}
          <TouchableOpacity
            style={t.backdrop}
            activeOpacity={1}
            onPress={() => { setModalVisible(false); setQuery(''); }}
          />

          {/* Sheet */}
          <View style={t.sheet}>
            {/* Handle */}
            <View style={t.handle} />

            {/* Header */}
            <View style={t.modalHeader}>
              <TouchableOpacity onPress={() => { setModalVisible(false); setQuery(''); }}>
                <Text style={t.cancelText}>Annuler</Text>
              </TouchableOpacity>
              <Text style={t.modalTitle}>Choisir des tags</Text>
              <TouchableOpacity
                onPress={() => { setModalVisible(false); setQuery(''); }}
                testID="confirm-tag-picker-btn"
              >
                <Ionicons name="checkmark-circle" size={28} color={accentColor} />
              </TouchableOpacity>
            </View>

            {/* ── Champ de recherche ────────────────────────────────────── */}
            <View style={t.searchRow}>
              <Ionicons name="search-outline" size={16} color={Colors.muted} style={{ marginLeft: 12 }} />
              <TextInput
                style={t.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Rechercher une catégorie ou un tag…"
                placeholderTextColor={Colors.muted}
                autoCorrect={false}
                clearButtonMode="while-editing"
                testID="tag-search-input"
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')} style={{ marginRight: 10 }}>
                  <Ionicons name="close-circle" size={16} color={Colors.muted} />
                </TouchableOpacity>
              )}
            </View>

            {/* ── Compteur + Effacer ───────────────────────────────────── */}
            {count > 0 && (
              <View style={t.selectedBanner}>
                <Text style={[t.selectedText, { color: accentColor }]}>
                  {count} tag{count > 1 ? 's' : ''} sélectionné{count > 1 ? 's' : ''}
                  {maxSelect ? ` (max ${maxSelect})` : ''}
                </Text>
                <TouchableOpacity onPress={() => onChangeTagIds([])}>
                  <Text style={t.clearText}>Effacer</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Liste catégories + tags ──────────────────────────────── */}
            {loading ? (
              <ActivityIndicator color={accentColor} style={{ marginTop: 32 }} />
            ) : (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={t.listContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {filteredCategories.length === 0 && (
                  <View style={t.emptyState}>
                    <Ionicons name="search-outline" size={28} color={Colors.muted} />
                    <Text style={t.emptyText}>Aucun résultat pour "{query}"</Text>
                  </View>
                )}

                {filteredCategories.map(cat => {
                  const col = catColor(cat.category_id);
                  const catTags = cat.tags || [];
                  return (
                    <View key={cat.category_id} style={t.catGroup}>
                      <View style={t.catLabelRow}>
                        <View style={[t.catDot, { backgroundColor: col }]} />
                        <Text style={t.catLabel}>{cat.label_fr}</Text>
                      </View>
                      <View style={t.tagsWrap}>
                        {catTags.map(tag => {
                          const sel      = selectedTagIds.includes(tag.tag_id);
                          const disabled = !sel && !!maxSelect && count >= maxSelect;
                          return (
                            <TouchableOpacity
                              key={tag.tag_id}
                              style={[
                                t.tagChip,
                                sel      && { backgroundColor: col + '22', borderColor: col },
                                disabled && { opacity: 0.35 },
                              ]}
                              onPress={() => !disabled && toggleTag(tag.tag_id)}
                              testID={`tag-chip-${tag.tag_id}`}
                              activeOpacity={0.75}
                            >
                              {sel && <Ionicons name="checkmark" size={12} color={col} style={{ marginRight: 3 }} />}
                              <Text style={[t.tagChipText, sel && { color: col, fontWeight: '700' }]}>
                                {tag.label_fr}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */
const t = StyleSheet.create({
  wrap:          { gap: 8 },
  fieldLabel:    { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  hint:          { fontSize: 11, color: Colors.muted, lineHeight: 15 },

  domainsRow:    { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  domainPill:    { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border },
  domainPillText:{ fontSize: 13, fontWeight: '600', color: Colors.muted },

  previewRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  previewPill:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1.5 },
  previewPillText:{ fontSize: 12, fontWeight: '600' },

  trigger:       { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 13 },
  triggerText:   { flex: 1, fontSize: 14, fontWeight: '500', color: Colors.muted },
  triggerCount:  { fontSize: 12, fontWeight: '700', color: Colors.muted },

  // Modal
  overlay:       { flex: 1, justifyContent: 'flex-end' },
  backdrop:      { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet:         { height: '75%', backgroundColor: Colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  handle:        { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginTop: 10, marginBottom: 4 },

  modalHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  cancelText:    { fontSize: 15, color: Colors.muted },
  modalTitle:    { fontSize: 16, fontWeight: '800', color: Colors.foreground },

  searchRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.background, borderRadius: Radius.md, margin: Spacing.md, marginBottom: 4, borderWidth: 1, borderColor: Colors.border, gap: 6 },
  searchInput:   { flex: 1, fontSize: 14, color: Colors.foreground, paddingVertical: 11, paddingRight: 4 },

  selectedBanner:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: 8, backgroundColor: Colors.background },
  selectedText:  { fontSize: 13, fontWeight: '600' },
  clearText:     { fontSize: 13, color: Colors.muted, textDecorationLine: 'underline' },

  listContent:   { padding: Spacing.md, paddingBottom: 40, gap: 20 },
  emptyState:    { alignItems: 'center', gap: 10, paddingVertical: 40 },
  emptyText:     { fontSize: 14, color: Colors.muted },

  catGroup:      { gap: 10 },
  catLabelRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catDot:        { width: 8, height: 8, borderRadius: 4 },
  catLabel:      { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 },

  tagsWrap:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background },
  tagChipText:   { fontSize: 13, fontWeight: '500', color: Colors.foreground },
});
