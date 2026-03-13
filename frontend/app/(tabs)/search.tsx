import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, Modal, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
;
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { api } from '../../lib/api';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { useLocation } from '../../context/LocationContext';
import { haversineDistance, formatDistance } from '../../utils/distance';
import { MapViewComponent, MapPin } from '../../components/MapViewComponent';
import { useGuardedRouter } from '../../hooks/useGuardedRouter';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Tag { tag_id: string; label_fr: string; label_en: string; name: string; }
interface Category { category_id: string; label_fr: string; label_en: string; name: string; tags: Tag[]; }

// ─── Constants ────────────────────────────────────────────────────────────────
const SERVICE_ORANGE = '#FF9500';
const SERVICE_ORANGE_BG = 'rgba(255,149,0,0.10)';

// ─── Star Rating ──────────────────────────────────────────────────────────────
function StarRating({ rating = 0 }: { rating?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[...Array(5)].map((_, i) => (
        <Ionicons key={i} name={i < rating ? 'star' : 'star-outline'} size={14}
          color={i < rating ? Colors.star : Colors.starEmpty} />
      ))}
    </View>
  );
}

// ─── Result Item ──────────────────────────────────────────────────────────────
function ResultItem({ image, title, author, distance, rating = 0, onPress, isService = false, price }:
  { image?: string; title: string; author: string; distance: string; rating?: number;
    onPress: () => void; isService?: boolean; price?: number }) {
  const accent = isService ? SERVICE_ORANGE : Colors.primary;
  return (
    <TouchableOpacity
      style={[itemSt.container, isService && itemSt.serviceContainer]}
      onPress={onPress} activeOpacity={0.7} testID={isService ? 'service-result-item' : 'result-item'}
    >
      <View style={itemSt.imgBox}>
        {image
          ? <Image source={{ uri: image }} style={itemSt.img} />
          : <View style={[itemSt.imgPlaceholder, isService && { backgroundColor: SERVICE_ORANGE_BG }]}>
              <Ionicons name={isService ? 'calendar-outline' : 'image-outline'} size={24} color={accent} />
            </View>}
        <View style={[itemSt.typeBadge, { backgroundColor: accent }]}>
          <Text style={itemSt.typeBadgeText}>{isService ? 'Service' : 'SpotYou'}</Text>
        </View>
      </View>
      <View style={itemSt.content}>
        <Text style={itemSt.title} numberOfLines={1}>{title}</Text>
        <Text style={itemSt.author} numberOfLines={1}>{author}</Text>
        {isService && price != null
          ? <Text style={[itemSt.distance, { color: SERVICE_ORANGE }]}>À partir de {price}€</Text>
          : <Text style={itemSt.distance}>{distance}</Text>}
      </View>
      <View style={itemSt.right}>
        {!isService && <StarRating rating={rating} />}
        {isService && distance ? <Text style={[itemSt.viewText, { color: SERVICE_ORANGE, fontWeight: '600' }]}>{distance}</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={itemSt.viewText}>Voir</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const itemSt = StyleSheet.create({
  container: { flexDirection: 'row', paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: Spacing.md },
  serviceContainer: { backgroundColor: 'rgba(255,149,0,0.04)', borderRadius: Radius.md, paddingHorizontal: 8, marginHorizontal: -8, borderBottomWidth: 0, marginBottom: 2, borderWidth: 1, borderColor: 'rgba(255,149,0,0.15)' },
  imgBox: { width: 80, height: 60, borderRadius: Radius.sm, overflow: 'hidden', position: 'relative' },
  img: { width: '100%', height: '100%' },
  imgPlaceholder: { width: '100%', height: '100%', backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  typeBadge: { position: 'absolute', bottom: 3, left: 3, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  typeBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.3 },
  content: { flex: 1, justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
  author: { fontSize: 13, color: Colors.muted, marginTop: 2 },
  distance: { fontSize: 13, fontWeight: '600', color: Colors.foreground, marginTop: 4 },
  right: { alignItems: 'flex-end', justifyContent: 'center', gap: 8 },
  viewText: { fontSize: 13, color: Colors.muted },
});

// ─── Tag Modal ─────────────────────────────────────────────────────────────────
function TagModal({ visible, categories, selectedTags, onToggle, onClear, onClose }:
  { visible: boolean; categories: Category[]; selectedTags: string[];
    onToggle: (id: string) => void; onClear: () => void; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={modalSt.overlay}>
        <View style={modalSt.sheet}>
          {/* Header */}
          <View style={modalSt.header}>
            <TouchableOpacity onPress={onClear} testID="modal-clear-btn">
              <Text style={modalSt.clearText}>Effacer</Text>
            </TouchableOpacity>
            <Text style={modalSt.headerTitle}>Chercher des tags</Text>
            <TouchableOpacity onPress={onClose} testID="modal-close-btn">
              <Text style={modalSt.doneText}>Terminer</Text>
            </TouchableOpacity>
          </View>

          {/* Categories + Tags */}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={modalSt.scroll}>
            {categories.filter(c => c.tags.length > 0).map(cat => (
              <View key={cat.category_id} style={modalSt.category}>
                <Text style={modalSt.catLabel}>{cat.label_fr}</Text>
                <View style={modalSt.tagRow}>
                  {cat.tags.map(tag => {
                    const isSelected = selectedTags.includes(tag.tag_id);
                    return (
                      <TouchableOpacity
                        key={tag.tag_id}
                        style={[modalSt.tagPill, isSelected && modalSt.tagPillSelected]}
                        onPress={() => onToggle(tag.tag_id)}
                        testID={`tag-pill-${tag.tag_id}`}
                      >
                        <Text style={[modalSt.tagText, isSelected && modalSt.tagTextSelected]}>
                          {tag.label_fr}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const modalSt = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  clearText: { fontSize: 14, color: Colors.muted },
  doneText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  scroll: { padding: Spacing.md },
  category: { marginBottom: Spacing.lg },
  catLabel: { fontSize: 13, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card },
  tagPillSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tagText: { fontSize: 13, color: Colors.foreground, fontWeight: '500' },
  tagTextSelected: { color: '#fff', fontWeight: '700' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SearchScreen() {
  const router = useGuardedRouter();
  const [radiusKm, setRadiusKm] = useState(40);
  const [combineMode, setCombineMode] = useState(false);
  const [SpotYou, setSpotYou] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { location } = useLocation();

  // Vue : liste ou carte
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // Tag state
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showTagModal, setShowTagModal] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});

  // Load categories + tags map once
  useEffect(() => {
    api.get('/tags/categories').then((cats: Category[]) => {
      setCategories(cats);
      const map: Record<string, Tag> = {};
      cats.forEach(c => c.tags.forEach(t => { map[t.tag_id] = t; }));
      setTagsMap(map);
    }).catch(() => {});
  }, []);

  // Search on location / radius change
  useEffect(() => {
    if (location) doSearch();
  }, [location.lat, location.lng, radiusKm]);

  const doSearch = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        lat: location.lat.toString(),
        lng: location.lng.toString(),
        radius: (radiusKm * 1000).toString(),
      });
      const [pts, svcs] = await Promise.all([
        api.get(`/tag-points?${params.toString()}`).catch(() => []),
        api.get(`/services?${params.toString()}`).catch(() => []),
      ]);
      setSpotYou(Array.isArray(pts) ? pts : []);
      setServices(Array.isArray(svcs) ? svcs : []);
    } catch {}
    finally { setLoading(false); }
  }, [location.lat, location.lng, radiusKm]);

  const getDistance = (pt: any) => {
    const lat = pt.latitude ?? pt.location?.coordinates?.[1];
    const lng = pt.longitude ?? pt.location?.coordinates?.[0];
    if (lat == null || lng == null) return '---';
    return formatDistance(haversineDistance(location.lat, location.lng, lat, lng));
  };

  const getServiceDistance = (svc: any) => {
    const loc = svc.locations?.[0];
    if (!loc) return '';
    return formatDistance(haversineDistance(location.lat, location.lng, loc.latitude, loc.longitude));
  };

  // Filter + sort by distance (closest first)
  const combinedResults = useMemo(() => {
    const getDistVal = (item: any) => {
      if (item._type === 'service') {
        const loc = item.locations?.[0];
        if (!loc) return Infinity;
        return haversineDistance(location.lat, location.lng, loc.latitude, loc.longitude);
      }
      const lat = item.latitude ?? item.location?.coordinates?.[1];
      const lng = item.longitude ?? item.location?.coordinates?.[0];
      if (lat == null || lng == null) return Infinity;
      return haversineDistance(location.lat, location.lng, lat, lng);
    };
    const filterByTags = (items: any[], getTagsFn: (i: any) => string[]) => {
      if (selectedTags.length === 0) return items;
      return items.filter(item => {
        const itemTags = getTagsFn(item);
        return combineMode
          ? selectedTags.every(t => itemTags.includes(t))
          : selectedTags.some(t => itemTags.includes(t));
      });
    };
    const filteredSpotYou = filterByTags(SpotYou, pt => pt.tag_ids || []);
    const filteredServices = filterByTags(services, svc => svc.tag_ids || []);
    const mixed = [
      ...filteredServices.map(s => ({ ...s, _type: 'service' as const })),
      ...filteredSpotYou.map(p => ({ ...p, _type: 'spotyou' as const })),
    ];
    return mixed.sort((a, b) => getDistVal(a) - getDistVal(b));
  }, [SpotYou, services, selectedTags, combineMode, location.lat, location.lng]);

  // ─── Pins pour la vue carte ───────────────────────────────────────────────
  const mapPins = useMemo<MapPin[]>(() => {
    return combinedResults
      .map(item => {
        if (item._type === 'service') {
          const loc = item.locations?.[0];
          if (!loc?.latitude || !loc?.longitude) return null;
          const label = item.price ? `${Math.round(item.price)}€` : 'Service';
          return { id: item.service_id, lat: loc.latitude, lng: loc.longitude,
            title: item.title, color: SERVICE_ORANGE, label };
        }
        const lat = item.latitude ?? item.location?.coordinates?.[1];
        const lng = item.longitude ?? item.location?.coordinates?.[0];
        if (lat == null || lng == null) return null;
        const label = item.rating ? `★ ${Number(item.rating).toFixed(1)}` : 'SpotYou';
        return { id: item.point_id, lat, lng, title: item.title, color: Colors.primary, label };
      })
      .filter(Boolean) as MapPin[];
  }, [combinedResults]);

  const selectedMapItem = useMemo(() =>
    selectedItemId ? combinedResults.find(i =>
      (i._type === 'service' ? i.service_id : i.point_id) === selectedItemId
    ) : null,
  [selectedItemId, combinedResults]);

  const toggleTag = (id: string) => {
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={Colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Résultats</Text>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {/* Toggle liste / carte */}
          <View style={toggleSt.wrap}>
            <TouchableOpacity
              style={[toggleSt.btn, viewMode === 'list' && toggleSt.active]}
              onPress={() => setViewMode('list')} testID="view-list-btn">
              <Ionicons name="list" size={18} color={viewMode === 'list' ? '#fff' : Colors.muted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[toggleSt.btn, viewMode === 'map' && toggleSt.active]}
              onPress={() => setViewMode('map')} testID="view-map-btn">
              <Ionicons name="map" size={18} color={viewMode === 'map' ? '#fff' : Colors.muted} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.headerAction} onPress={() => router.push('/set-location' as any)}>
            <Ionicons name="location" size={24} color={Colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {viewMode === 'map' ? (
        /* ─── VUE CARTE ─────────────────────────────────────── */
        <View style={{ flex: 1 }}>
          {/* Barre de filtres compacte */}
          <View style={styles.tagInputRow}>
            <TouchableOpacity
              style={[styles.tagBtn, selectedTags.length > 0 && styles.tagBtnActive]}
              onPress={() => setShowTagModal(true)} testID="tag-search-button" activeOpacity={0.8}
            >
              <Ionicons name="pricetags-outline" size={16} color={selectedTags.length > 0 ? Colors.primary : Colors.muted} />
              {selectedTags.length === 0
                ? <Text style={styles.tagBtnPlaceholder}>Chercher des tags</Text>
                : <Text style={styles.tagBtnCount} numberOfLines={1}>
                    {tagsMap[selectedTags[0]]?.label_fr || '1 tag'}
                    {selectedTags.length > 1 ? ` +${selectedTags.length - 1}` : ''}
                  </Text>}
              {selectedTags.length > 0
                ? <TouchableOpacity onPress={() => setSelectedTags([])} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={18} color={Colors.primary} />
                  </TouchableOpacity>
                : <Ionicons name="chevron-down" size={16} color={Colors.muted} />}
            </TouchableOpacity>
            <View style={{ paddingHorizontal: 10, paddingVertical: 8, backgroundColor: Colors.card, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.foreground }}>{radiusKm} km</Text>
            </View>
          </View>

          {/* Carte */}
          <MapViewComponent
            centerLat={location.lat}
            centerLng={location.lng}
            zoom={11}
            pins={mapPins}
            showUserMarker
            searchRadius={radiusKm * 1000}
            onPinPress={(id) => setSelectedItemId(prev => prev === id ? null : id)}
            style={{ flex: 1 }}
          />

          {/* Badge résultats flottant — toujours visible en vue carte */}
          <View style={resultBadgeSt.wrap} pointerEvents="box-none">
            <View style={resultBadgeSt.pill}>
              <Text style={resultBadgeSt.text}>
                {combinedResults.length} résultat{combinedResults.length !== 1 ? 's' : ''}
                {selectedTags.length > 0 ? ` · ${selectedTags.length} tag${selectedTags.length !== 1 ? 's' : ''} (${combineMode ? 'ET' : 'OU'})` : ''}
              </Text>
              {selectedTags.length > 0 && (
                <TouchableOpacity onPress={() => setSelectedTags([])}>
                  <Text style={resultBadgeSt.clear}>Effacer</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Carte flottante item sélectionné */}
          {selectedMapItem && (
            <TouchableOpacity
              style={mapCardSt.card}
              activeOpacity={0.92}
              onPress={() => {
                const item = selectedMapItem;
                if (item._type === 'service') router.push(`/service/${item.service_id}` as any);
                else router.push(`/spot-you/${item.point_id}`);
              }}
            >
              {selectedMapItem.images?.[0] || selectedMapItem.locations?.[0] ? (
                <Image
                  source={{ uri: selectedMapItem.images?.[0] }}
                  style={mapCardSt.img}
                  resizeMode="cover"
                />
              ) : (
                <View style={[mapCardSt.img, mapCardSt.imgPlaceholder]}>
                  <Ionicons name="image-outline" size={32} color={Colors.muted} />
                </View>
              )}
              <View style={mapCardSt.info}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <View style={[mapCardSt.badge, { backgroundColor: selectedMapItem._type === 'service' ? SERVICE_ORANGE : Colors.primary }]}>
                    <Text style={mapCardSt.badgeText}>{selectedMapItem._type === 'service' ? 'Service' : 'SpotYou'}</Text>
                  </View>
                </View>
                <Text style={mapCardSt.title} numberOfLines={2}>{selectedMapItem.title || 'Sans titre'}</Text>
                <Text style={mapCardSt.sub} numberOfLines={1}>
                  {selectedMapItem._type === 'service'
                    ? (selectedMapItem.price ? `À partir de ${selectedMapItem.price}€` : selectedMapItem.coach?.name || 'Coach')
                    : (selectedMapItem.owner?.name || 'Anonyme')}
                </Text>
                {selectedMapItem._type !== 'service' && selectedMapItem.rating > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                    <Ionicons name="star" size={12} color={Colors.star} />
                    <Text style={{ fontSize: 12, color: Colors.muted }}>{Number(selectedMapItem.rating).toFixed(1)}</Text>
                  </View>
                )}
              </View>
              <Ionicons name="chevron-forward" size={20} color={Colors.primary} style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>
          )}
        </View>
      ) : (
        /* ─── VUE LISTE ─────────────────────────────────────── */
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Tag search row */}
        <View style={styles.tagInputRow}>
          <TouchableOpacity
            style={[styles.tagBtn, selectedTags.length > 0 && styles.tagBtnActive]}
            onPress={() => setShowTagModal(true)}
            testID="tag-search-button"
            activeOpacity={0.8}
          >
            <Ionicons
              name="pricetags-outline"
              size={16}
              color={selectedTags.length > 0 ? Colors.primary : Colors.muted}
            />
            {selectedTags.length === 0 ? (
              <Text style={styles.tagBtnPlaceholder}>Chercher des tags</Text>
            ) : (
              <Text style={styles.tagBtnCount} numberOfLines={1}>
                {selectedTags.length === 1
                  ? tagsMap[selectedTags[0]]?.label_fr || '1 tag'
                  : `${tagsMap[selectedTags[0]]?.label_fr || ''}${selectedTags.length > 1 ? ` +${selectedTags.length - 1}` : ''}`}
              </Text>
            )}
            {selectedTags.length > 0 ? (
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation?.(); setSelectedTags([]); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID="clear-tags-btn"
              >
                <Ionicons name="close-circle" size={18} color={Colors.primary} />
              </TouchableOpacity>
            ) : (
              <Ionicons name="chevron-down" size={16} color={Colors.muted} />
            )}
          </TouchableOpacity>

          {/* Combine toggle */}
          <View style={styles.combineRow}>
            <Text style={styles.combineLabel}>Combiner</Text>
            <TouchableOpacity
              style={[styles.combineToggle, combineMode && styles.combineToggleActive]}
              onPress={() => setCombineMode(!combineMode)}
              testID="combine-toggle"
            >
              {combineMode && <View style={styles.combineToggleDot} />}
            </TouchableOpacity>
          </View>
        </View>

        {/* Selected tags chips row */}
        {selectedTags.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
            style={styles.chipsScroll}
          >
            {selectedTags.map(id => (
              <View key={id} style={styles.chip} testID={`selected-chip-${id}`}>
                <Text style={styles.chipText}>{tagsMap[id]?.label_fr || id}</Text>
                <TouchableOpacity
                  onPress={() => toggleTag(id)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="close" size={13} color={Colors.primary} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Location row */}
        <TouchableOpacity style={styles.locationRow} onPress={() => router.push('/set-location' as any)}>
          <Ionicons name="location" size={20} color={Colors.primary} />
          <Text style={styles.locationText} numberOfLines={1} testID="location-text">
            {location.address || 'Paris, France'}
          </Text>
        </TouchableOpacity>

        {/* Distance Slider */}
        <View style={styles.sliderSection}>
          <Text style={styles.sliderValue}>{radiusKm}Km</Text>
          <View style={styles.sliderRow}>
            <TouchableOpacity onPress={() => setRadiusKm(Math.max(1, radiusKm - 5))}>
              <View style={styles.sliderEndCircle} />
            </TouchableOpacity>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={100}
              value={radiusKm}
              onValueChange={val => setRadiusKm(Math.round(val))}
              minimumTrackTintColor={Colors.primary}
              maximumTrackTintColor={Colors.border}
              thumbTintColor={Colors.foreground}
            />
            <TouchableOpacity onPress={() => setRadiusKm(Math.min(100, radiusKm + 5))}>
              <Ionicons name="radio-button-on" size={24} color={Colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Results */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.primary} size="large" />
          </View>
        ) : (
          <View style={styles.results}>
            {/* Active filter badge */}
            {selectedTags.length > 0 && (
              <View style={styles.filterBadge} testID="filter-badge">
                <Text style={styles.filterBadgeText}>
                  {combinedResults.length} résultat{combinedResults.length !== 1 ? 's' : ''} · {selectedTags.length} tag{selectedTags.length !== 1 ? 's' : ''} {combineMode ? '(ET)' : '(OU)'}
                </Text>
                <TouchableOpacity onPress={() => setSelectedTags([])} testID="clear-filter-btn">
                  <Text style={styles.filterClearText}>Effacer</Text>
                </TouchableOpacity>
              </View>
            )}
            {combinedResults.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={48} color={Colors.muted} />
                <Text style={styles.emptyText}>Aucun résultat trouvé</Text>
              </View>
            ) : (
              combinedResults.map((item) => {
                if (item._type === 'service') {
                  return (
                    <ResultItem
                      key={'svc_' + item.service_id}
                      isService
                      image={item.images?.[0]}
                      title={item.title || 'Sans titre'}
                      author={item.coach?.name || 'Coach'}
                      distance={getServiceDistance(item)}
                      price={item.price}
                      onPress={() => router.push(`/service/${item.service_id}` as any)}
                    />
                  );
                }
                return (
                  <ResultItem
                    key={item.point_id}
                    image={item.images?.[0]}
                    title={item.title || 'Sans titre'}
                    author={item.owner?.name || 'Anonyme'}
                    distance={getDistance(item)}
                    rating={item.rating || 0}
                    onPress={() => router.push(`/spot-you/${item.point_id}`)}
                  />
                );
              })
            )}
          </View>
        )}
      </ScrollView>
      )}

      {/* Tag Modal */}
      <TagModal
        visible={showTagModal}
        categories={categories}
        selectedTags={selectedTags}
        onToggle={toggleTag}
        onClear={() => setSelectedTags([])}
        onClose={() => setShowTagModal(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.header },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, backgroundColor: Colors.header },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: Colors.primary },
  headerAction: { padding: 4 },
  content: { flex: 1, backgroundColor: Colors.background },

  tagInputRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.sm, gap: Spacing.md },
  tagBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.header,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tagBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.card,
  },
  tagBtnPlaceholder: { flex: 1, fontSize: 14, color: Colors.muted },
  tagBtnCount: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foreground },

  chipsScroll: { paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
  chipsRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radius.full,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.primary },

  combineRow: { alignItems: 'center', gap: 4 },
  combineLabel: { fontSize: 12, color: Colors.muted },
  combineToggle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: Colors.muted, alignItems: 'center', justifyContent: 'center' },
  combineToggleActive: { borderColor: Colors.primary },
  combineToggleDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.primary },

  locationRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, gap: 8, marginBottom: Spacing.sm },
  locationText: { flex: 1, fontSize: 14, color: Colors.foreground },

  sliderSection: { paddingHorizontal: Spacing.md, marginBottom: Spacing.md },
  sliderValue: { fontSize: 13, color: Colors.muted, textAlign: 'center', marginBottom: 4 },
  sliderRow: { flexDirection: 'row', alignItems: 'center' },
  sliderEndCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.muted },
  slider: { flex: 1, height: 40 },

  results: { paddingHorizontal: Spacing.md, paddingBottom: 40 },
  filterBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, backgroundColor: Colors.card, borderRadius: Radius.md, marginBottom: Spacing.md },
  filterBadgeText: { fontSize: 13, color: Colors.muted },
  filterClearText: { fontSize: 13, fontWeight: '600', color: Colors.primary },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  empty: { alignItems: 'center', padding: Spacing.xl, gap: 12 },
  emptyText: { fontSize: 15, color: Colors.muted, textAlign: 'center' },
});

// ─── Toggle List/Map ───────────────────────────────────────────────────────────
const toggleSt = StyleSheet.create({
  wrap: { flexDirection: 'row', backgroundColor: Colors.card, borderRadius: Radius.full, padding: 3, borderWidth: 1, borderColor: Colors.border },
  btn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full },
  active: { backgroundColor: Colors.primary },
});

// ─── Map item card ─────────────────────────────────────────────────────────────
const mapCardSt = StyleSheet.create({  card: {
    position: 'absolute', bottom: 20, left: 16, right: 16,
    backgroundColor: Colors.card, borderRadius: 16,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  img: { width: 72, height: 72, borderRadius: 12 },
  imgPlaceholder: { backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#fff', textTransform: 'uppercase' },
  title: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  sub: { fontSize: 13, color: Colors.muted, marginTop: 2 },
});


// ─── Badge résultats (vue carte) ──────────────────────────────────────────────
const resultBadgeSt = StyleSheet.create({
  wrap: {
    position: 'absolute', bottom: 130, left: 0, right: 0,
    alignItems: 'center', pointerEvents: 'box-none',
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(13,17,23,0.88)',
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: Radius.full,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  text: { fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: '500' },
  clear: { fontSize: 14, color: Colors.primary, fontWeight: '700' },
});
