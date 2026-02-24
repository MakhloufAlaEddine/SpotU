import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MapViewComponent } from '../../components/MapViewComponent';
import { WButton } from '../../components/WButton';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius, Shadow } from '../../constants/Colors';

export default function TagPointDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { t, lang } = useLang();
  const [point, setPoint] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (id) loadPoint();
  }, [id]);

  const loadPoint = async () => {
    try {
      const data = await api.get(`/tag-points/${id}`);
      setPoint(data);
    } catch (err: any) {
      Alert.alert(t('error'), err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    Alert.alert(t('delete'), 'Supprimer ce TagPoint ?', [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'), style: 'destructive', onPress: async () => {
          setDeleting(true);
          try {
            await api.del(`/tag-points/${id}`);
            router.back();
          } catch (err: any) {
            Alert.alert(t('error'), err.message);
            setDeleting(false);
          }
        }
      }
    ]);
  };

  if (loading) return (
    <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
  );
  if (!point) return (
    <View style={styles.center}><Text style={styles.notFound}>TagPoint introuvable</Text></View>
  );

  const lat = point.location?.coordinates?.[1];
  const lng = point.location?.coordinates?.[0];
  const isOwner = user?.user_id === point.user_id;
  const tags: any[] = point.tags || [];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Map preview */}
        {lat && lng && (
          <View style={styles.mapWrap} testID="tagpoint-map">
            <MapViewComponent
              centerLat={lat}
              centerLng={lng}
              zoom={15}
              pins={[{ id: point.point_id, lat, lng, title: point.title, color: Colors.primary, type: 'tagpoint' }]}
              style={styles.map}
            />
          </View>
        )}

        <View style={styles.content}>
          {/* Tags */}
          {tags.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagsRow}>
              {tags.map((tag) => (
                <View key={tag.tag_id} style={styles.tag}>
                  <Text style={styles.tagText}>{lang === 'fr' ? tag.label_fr : tag.label_en}</Text>
                </View>
              ))}
            </ScrollView>
          )}

          <Text style={styles.title}>{point.title}</Text>
          {point.description && <Text style={styles.desc}>{point.description}</Text>}

          <View style={styles.meta}>
            {point.owner && (
              <View style={styles.metaItem}>
                <Text style={styles.metaIcon}>👤</Text>
                <Text style={styles.metaText}>{point.owner.name}</Text>
              </View>
            )}
            <View style={styles.metaItem}>
              <Text style={styles.metaIcon}>📍</Text>
              <Text style={styles.metaText}>Précision: {point.precision}</Text>
            </View>
            {point.expires_at && (
              <View style={styles.metaItem}>
                <Text style={styles.metaIcon}>⏰</Text>
                <Text style={styles.metaText}>Expire: {new Date(point.expires_at).toLocaleDateString()}</Text>
              </View>
            )}
          </View>

          {/* Owner actions */}
          {isOwner && (
            <WButton
              label={`🗑️ ${t('delete')}`}
              onPress={handleDelete}
              loading={deleting}
              variant="danger"
              style={styles.deleteBtn}
              testID="delete-tagpoint-btn"
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFound: { fontSize: 16, color: Colors.muted },
  scroll: { paddingBottom: 40 },
  mapWrap: { height: 250 },
  map: { flex: 1 },
  content: { padding: Spacing.lg },
  tagsRow: { marginBottom: Spacing.sm },
  tag: { backgroundColor: Colors.primaryLight, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 5, marginRight: 8 },
  tagText: { fontSize: 12, color: Colors.primary, fontWeight: '700' },
  title: { fontSize: 24, fontWeight: '900', color: Colors.foreground, marginBottom: Spacing.sm },
  desc: { fontSize: 15, color: Colors.muted, lineHeight: 22, marginBottom: Spacing.md },
  meta: { gap: 10, marginBottom: Spacing.lg, padding: Spacing.md, backgroundColor: Colors.secondary, borderRadius: Radius.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaIcon: { fontSize: 16 },
  metaText: { fontSize: 14, color: Colors.foreground },
  deleteBtn: { marginTop: Spacing.sm },
});
