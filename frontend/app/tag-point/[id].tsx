import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, Alert, Image, Share, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MapViewComponent } from '../../components/MapViewComponent';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';

// Star Rating Component
function StarRating({ rating = 0, votes = 0 }: { rating?: number; votes?: number }) {
  return (
    <View style={starStyles.container}>
      {[...Array(5)].map((_, index) => (
        <Ionicons
          key={index}
          name={index < rating ? 'star' : 'star-outline'}
          size={18}
          color={index < rating ? Colors.star : Colors.muted}
        />
      ))}
      <Text style={starStyles.votes}>{votes} votes</Text>
    </View>
  );
}

const starStyles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  votes: { fontSize: 14, color: Colors.foreground, marginLeft: 8 },
});

// Action Button Component
function ActionButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={actionStyles.container} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={24} color={Colors.foreground} />
      <Text style={actionStyles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const actionStyles = StyleSheet.create({
  container: { alignItems: 'center', gap: 4, flex: 1 },
  label: { fontSize: 13, color: Colors.foreground },
});

export default function TagPointDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { t, lang } = useLang();
  const [point, setPoint] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showFullDesc, setShowFullDesc] = useState(false);

  // Hide expo-router header on web
  useEffect(() => {
    if (Platform.OS === 'web') {
      // Find and hide the navigation header
      const hideHeader = () => {
        // Look for any element containing "TagPoint" text at the top
        const allElements = document.querySelectorAll('*');
        allElements.forEach((el: any) => {
          if (el.textContent === 'TagPoint' && el.tagName !== 'SCRIPT') {
            const parent = el.closest('div');
            if (parent && parent.getBoundingClientRect().top < 60) {
              parent.style.display = 'none';
            }
          }
        });
        // Also try to hide any header with green/teal text at the top
        const topElements = document.querySelectorAll('div');
        topElements.forEach((el: any) => {
          const rect = el.getBoundingClientRect();
          if (rect.top < 50 && rect.height < 60 && rect.height > 20) {
            const style = window.getComputedStyle(el);
            if (style.color.includes('rgb(29, 191, 115)') || 
                el.textContent?.trim() === 'TagPoint') {
              el.style.display = 'none';
            }
          }
        });
      };
      
      // Run immediately and after a delay
      hideHeader();
      const timer1 = setTimeout(hideHeader, 100);
      const timer2 = setTimeout(hideHeader, 500);
      
      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
      };
    }
  }, []);

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

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Découvrez "${point.title}" sur WINEK!`,
        title: point.title,
      });
    } catch {}
  };

  const handleSendMessage = () => {
    Alert.alert('Message', 'Fonctionnalité de chat bientôt disponible !');
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays < 1) return 'Aujourd\'hui';
    if (diffDays === 1) return 'Hier';
    if (diffDays < 7) return `Il y a ${diffDays} jours`;
    if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} semaines`;
    if (diffDays < 365) return `Il y a ${Math.floor(diffDays / 30)} mois`;
    return `Il y a ${Math.floor(diffDays / 365)} ans`;
  };

  const formatDistance = (distance?: number) => {
    if (!distance) return '---';
    if (distance < 1000) return `${Math.round(distance)}M`;
    return `${(distance / 1000).toFixed(1)}KM`;
  };

  // Get precision radius for map circle
  const getPrecisionRadius = (precision: string) => {
    if (precision === '100m') return 100;
    if (precision === '1000m') return 1000;
    return 0;
  };

  if (loading) return (
    <View style={styles.fullScreen}>
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    </View>
  );

  if (!point) return (
    <View style={styles.fullScreen}>
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.muted} />
        <Text style={styles.notFound}>TagPoint introuvable</Text>
      </View>
    </View>
  );

  const lat = point.latitude || point.location?.coordinates?.[1];
  const lng = point.longitude || point.location?.coordinates?.[0];
  const tags: any[] = point.tags || [];
  const precisionRadius = getPrecisionRadius(point.precision);

  return (
    <View style={styles.fullScreen}>
      {/* Absolute positioned header to cover the navigation bar */}
      <View style={styles.absoluteHeader}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Details</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.headerBtn}>
              <Ionicons name="location" size={24} color={Colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerBtn}>
              <Ionicons name="search" size={24} color={Colors.primary} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView 
        style={styles.content} 
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Main Image with Owner Avatar */}
        <View style={styles.imageSection}>
          <View style={styles.imageContainer}>
            {point.image_url ? (
              <Image source={{ uri: point.image_url }} style={styles.mainImage} />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Ionicons name="football-outline" size={64} color={Colors.muted} />
              </View>
            )}
          </View>
          {/* Owner Avatar */}
          {point.owner && (
            <View style={styles.ownerAvatar}>
              {point.owner.picture ? (
                <Image source={{ uri: point.owner.picture }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarText}>
                    {point.owner.name?.charAt(0)?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Title */}
        <Text style={styles.title}>{point.title}</Text>

        {/* Info Row: Distance + Tag */}
        <View style={styles.infoRow}>
          <View style={styles.distanceTag}>
            <Ionicons name="location-outline" size={16} color={Colors.primary} />
            <Text style={styles.distanceText}>{formatDistance(point.distance)}</Text>
          </View>
          {tags.length > 0 && (
            <View style={styles.categoryTag}>
              <Text style={styles.categoryText}>
                {lang === 'fr' ? tags[0].label_fr : tags[0].label_en}
              </Text>
            </View>
          )}
        </View>

        {/* Created + Rating Row */}
        <View style={styles.createdRow}>
          <Text style={styles.createdText}>
            Created {formatTimeAgo(point.created_at)}
          </Text>
          <StarRating rating={point.rating || 0} votes={point.votes || 0} />
        </View>

        {/* Send Message Button */}
        <TouchableOpacity 
          style={styles.messageBtn} 
          onPress={handleSendMessage}
          activeOpacity={0.8}
        >
          <Text style={styles.messageBtnText}>Send a message</Text>
          <Ionicons name="send" size={20} color={Colors.background} />
        </TouchableOpacity>

        {/* Action Buttons Row */}
        <View style={styles.actionsRow}>
          <ActionButton icon="copy-outline" label="Similar" onPress={() => {}} />
          <ActionButton icon="share-social-outline" label="Share" onPress={handleShare} />
          <ActionButton icon="bookmark-outline" label="Save" onPress={() => {}} />
        </View>

        {/* Map with Precision Circle */}
        {lat && lng && (
          <View style={styles.mapWrap}>
            <MapViewComponent
              centerLat={lat}
              centerLng={lng}
              zoom={precisionRadius > 500 ? 14 : 16}
              precisionRadius={precisionRadius}
              selectedLat={lat}
              selectedLng={lng}
              style={styles.map}
            />
          </View>
        )}

        {/* Description */}
        {point.description && (
          <View style={styles.descSection}>
            <Text style={styles.descTitle}>Description</Text>
            <Text 
              style={styles.descText} 
              numberOfLines={showFullDesc ? undefined : 2}
            >
              {point.description}
            </Text>
            {point.description.length > 100 && (
              <TouchableOpacity onPress={() => setShowFullDesc(!showFullDesc)}>
                <Text style={styles.showMore}>
                  {showFullDesc ? 'Show Less' : 'Show More'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    backgroundColor: Colors.header,
    marginTop: -45, // Push content over the native header
  },
  absoluteHeader: {
    backgroundColor: Colors.header,
    paddingTop: 45,
    zIndex: 9999,
  },
  headerCover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 50,
    backgroundColor: Colors.header,
    zIndex: 100,
  },
  headerArea: {
    backgroundColor: Colors.header,
    paddingTop: 50,
    zIndex: 101,
  },
  safe: { 
    flex: 1, 
    backgroundColor: Colors.header 
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.header,
  },
  headerBtn: { padding: 4 },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.primary,
  },
  headerRight: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  content: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    paddingBottom: 40,
  },
  center: { 
    flex: 1, 
    alignItems: 'center', 
    justifyContent: 'center',
    gap: 12,
  },
  notFound: { 
    fontSize: 16, 
    color: Colors.muted 
  },
  imageSection: {
    position: 'relative',
    marginBottom: Spacing.md,
  },
  imageContainer: {
    height: 220,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  mainImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerAvatar: {
    position: 'absolute',
    top: Spacing.md + 10,
    right: Spacing.md + 10,
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: Colors.foreground,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.background,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.foreground,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  distanceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  distanceText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
  },
  categoryTag: {
    backgroundColor: 'transparent',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  categoryText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
  },
  createdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  createdText: {
    fontSize: 14,
    color: Colors.muted,
  },
  messageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.header,
    marginHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  messageBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.foreground,
  },
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: Spacing.md,
  },
  mapWrap: {
    height: 180,
    marginHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    marginBottom: Spacing.md,
  },
  map: {
    flex: 1,
  },
  descSection: {
    paddingHorizontal: Spacing.md,
  },
  descTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
    marginBottom: Spacing.xs,
  },
  descText: {
    fontSize: 15,
    color: Colors.muted,
    lineHeight: 22,
  },
  showMore: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
});
