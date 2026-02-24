import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Colors, Spacing, Radius } from '../constants/Colors';

interface Tag {
  tag_id: string;
  name: string;
  label_fr: string;
  label_en: string;
  category_id: string;
}

interface Category {
  category_id: string;
  label_fr: string;
  label_en: string;
}

interface Props {
  tags: Tag[];
  categories?: Category[];
  selectedIds: string[];
  onToggle: (tagId: string) => void;
  lang?: 'fr' | 'en';
  maxSelect?: number;
}

export function TagSelector({ tags, categories, selectedIds, onToggle, lang = 'fr', maxSelect }: Props) {
  const grouped: Record<string, Tag[]> = {};
  tags.forEach((tag) => {
    if (!grouped[tag.category_id]) grouped[tag.category_id] = [];
    grouped[tag.category_id].push(tag);
  });

  const getCatLabel = (catId: string) => {
    const cat = categories?.find((c) => c.category_id === catId);
    if (!cat) return catId;
    return lang === 'fr' ? cat.label_fr : cat.label_en;
  };

  return (
    <View style={styles.container}>
      {Object.entries(grouped).map(([catId, catTags]) => (
        <View key={catId} style={styles.group}>
          <Text style={styles.catLabel}>{getCatLabel(catId)}</Text>
          <View style={styles.tags}>
            {catTags.map((tag) => {
              const isSelected = selectedIds.includes(tag.tag_id);
              const canSelect = !maxSelect || selectedIds.length < maxSelect || isSelected;
              return (
                <TouchableOpacity
                  key={tag.tag_id}
                  testID={`tag-${tag.tag_id}`}
                  onPress={() => canSelect && onToggle(tag.tag_id)}
                  style={[styles.tag, isSelected && styles.tagSelected, !canSelect && styles.tagDisabled]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.tagText, isSelected && styles.tagTextSelected]}>
                    {lang === 'fr' ? tag.label_fr : tag.label_en}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  group: {},
  catLabel: { fontSize: 12, fontWeight: '700', color: Colors.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  tagSelected: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  tagDisabled: { opacity: 0.4 },
  tagText: { fontSize: 13, color: Colors.foreground, fontWeight: '500' },
  tagTextSelected: { color: Colors.primary, fontWeight: '700' },
});
