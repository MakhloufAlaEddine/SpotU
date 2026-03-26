/**
 * Step 3 — Photos du produit
 */
import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm } from '../ProductFormContext';

const BLUE = '#3B82F6';
const MAX_IMAGES = 6;

const TIPS = [
  { icon: 'sunny-outline',    text: 'Prends une photo nette et lumineuse' },
  { icon: 'expand-outline',   text: 'Montre le produit en entier' },
  { icon: 'contrast-outline', text: 'Évite les photos sombres ou floues' },
  { icon: 'image-outline',    text: 'Fond simple ou neutre si possible' },
];

export function Step3Photos() {
  const { form, set } = useProductForm();

  const pickImages = async () => {
    if (form.images.length >= MAX_IMAGES) {
      Alert.alert('Maximum atteint', `Vous pouvez ajouter au maximum ${MAX_IMAGES} photos.`);
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission refusée', 'L\'accès à la galerie est nécessaire pour ajouter des photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES - form.images.length,
      quality: 0.85,
    });
    if (!result.canceled) {
      const newUris = result.assets.map(a => a.uri);
      set({ images: [...form.images, ...newUris].slice(0, MAX_IMAGES) });
    }
  };

  const removeImage = (idx: number) => {
    const next = form.images.filter((_, i) => i !== idx);
    set({ images: next });
  };

  return (
    <View style={p.wrap}>
      {/* Conseils */}
      <View style={p.tipsCard}>
        <Text style={p.tipsTitle}>Conseils pour de bonnes photos</Text>
        {TIPS.map(t => (
          <View key={t.text} style={p.tipRow}>
            <Ionicons name={t.icon as any} size={14} color={BLUE} />
            <Text style={p.tipText}>{t.text}</Text>
          </View>
        ))}
      </View>

      {/* Grille photos */}
      <View>
        <View style={p.labelRow}>
          <Text style={p.label}>Photos</Text>
          <Text style={p.counter}>{form.images.length}/{MAX_IMAGES}</Text>
        </View>

        <View style={p.grid}>
          {form.images.map((uri, idx) => (
            <View key={uri + idx} style={[p.imgWrap, idx === 0 && p.imgMain]}>
              <Image source={{ uri }} style={p.img} resizeMode="cover" />
              {idx === 0 && (
                <View style={p.coverBadge}>
                  <Text style={p.coverText}>Principale</Text>
                </View>
              )}
              <TouchableOpacity
                style={p.removeBtn}
                onPress={() => removeImage(idx)}
                testID={`remove-img-${idx}`}
              >
                <Ionicons name="close-circle" size={22} color="#EF4444" />
              </TouchableOpacity>
            </View>
          ))}

          {form.images.length < MAX_IMAGES && (
            <TouchableOpacity
              style={[p.addBtn, form.images.length === 0 && p.addBtnMain]}
              onPress={pickImages}
              testID="add-photo-btn"
            >
              <Ionicons name="camera-outline" size={form.images.length === 0 ? 36 : 28} color={BLUE} />
              <Text style={p.addBtnText}>
                {form.images.length === 0 ? 'Ajouter une photo principale' : 'Ajouter'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {form.images.length === 0 && (
        <Text style={p.hint}>La photo principale est obligatoire — elle sera la première image visible dans la boutique.</Text>
      )}
      {form.images.length > 0 && form.images.length < 3 && (
        <Text style={p.hintGood}>
          Bien ! Ajoute {3 - form.images.length} photo{3 - form.images.length > 1 ? 's' : ''} supplémentaire{3 - form.images.length > 1 ? 's' : ''} pour renforcer la confiance des acheteurs.
        </Text>
      )}
    </View>
  );
}

const CELL = 156;

const p = StyleSheet.create({
  wrap:        { gap: Spacing.lg },
  tipsCard:    { backgroundColor: BLUE + '0D', borderRadius: Radius.md, borderWidth: 1, borderColor: BLUE + '30', padding: Spacing.md, gap: 8 },
  tipsTitle:   { fontSize: 13, fontWeight: '700', color: BLUE, marginBottom: 2 },
  tipRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tipText:     { fontSize: 12, color: Colors.foreground, flex: 1, lineHeight: 17 },
  labelRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  label:       { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  counter:     { fontSize: 12, color: Colors.muted },
  grid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  imgWrap:     { width: CELL, height: CELL, borderRadius: Radius.md, overflow: 'hidden', position: 'relative' },
  imgMain:     { width: '100%', height: 180 },
  img:         { width: '100%', height: '100%' },
  coverBadge:  { position: 'absolute', bottom: 8, left: 8, backgroundColor: BLUE, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  coverText:   { fontSize: 10, fontWeight: '700', color: '#fff' },
  removeBtn:   { position: 'absolute', top: 6, right: 6 },
  addBtn:      { width: CELL, height: CELL, borderRadius: Radius.md, borderWidth: 2, borderColor: BLUE + '55', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: BLUE + '05' },
  addBtnMain:  { width: '100%', height: 180 },
  addBtnText:  { fontSize: 12, fontWeight: '600', color: BLUE, textAlign: 'center' },
  hint:        { fontSize: 12, color: Colors.muted, textAlign: 'center', lineHeight: 18 },
  hintGood:    { fontSize: 12, color: BLUE, lineHeight: 18 },
});
