import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Image, Modal, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { api } from '../../lib/api';
import { Colors, Spacing, Radius } from '../../constants/Colors';

// Star Rating Component
function StarRating({ rating = 0, maxStars = 5 }: { rating?: number; maxStars?: number }) {
  return (
    <View style={starStyles.container}>
      {[...Array(maxStars)].map((_, index) => (
        <Ionicons
          key={index}
          name={index < rating ? 'star' : 'star-outline'}
          size={16}
          color={index < rating ? Colors.star : Colors.starEmpty}
        />
      ))}
    </View>
  );
}

const starStyles = StyleSheet.create({
  container: { flexDirection: 'row', gap: 2 },
});

// Tag Point Row Component
interface TagPointRowProps {
  image?: string;
  title: string;
  author: string;
  distance: string;
  rating?: number;
  onPress: () => void;
}

function TagPointRow({ image, title, author, distance, rating = 0, onPress }: TagPointRowProps) {
  return (
    <TouchableOpacity style={rowStyles.container} onPress={onPress} activeOpacity={0.7}>
      <View style={rowStyles.imageContainer}>
        {image ? (
          <Image source={{ uri: image }} style={rowStyles.image} />
        ) : (
          <View style={rowStyles.imagePlaceholder}>
            <Ionicons name="image-outline" size={20} color={Colors.muted} />
          </View>
        )}
      </View>
      <View style={rowStyles.content}>
        <Text style={rowStyles.title} numberOfLines={1}>{title}</Text>
        <Text style={rowStyles.author} numberOfLines={1}>{author}</Text>
        <Text style={rowStyles.distance}>{distance}</Text>
      </View>
      <View style={rowStyles.right}>
        <StarRating rating={rating} />
        <View style={rowStyles.viewBtn}>
          <Text style={rowStyles.viewText}>Voir</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  imageContainer: {
    width: 90,
    height: 70,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  image: {
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
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.foreground,
  },
  author: {
    fontSize: 13,
    color: Colors.muted,
    marginTop: 2,
  },
  distance: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.foreground,
    marginTop: 4,
  },
  right: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 8,
  },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewText: {
    fontSize: 14,
    color: Colors.primary,
  },
});

// Menu Item Component
interface MenuItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  rightText?: string;
  onPress: () => void;
}

function MenuItem({ icon, label, rightText, onPress }: MenuItemProps) {
  return (
    <TouchableOpacity style={menuStyles.item} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={24} color={Colors.foreground} />
      <Text style={menuStyles.label}>{label}</Text>
      {rightText && (
        <View style={menuStyles.rightContainer}>
          <Text style={menuStyles.rightText}>{rightText}</Text>
          <Ionicons name="chevron-expand" size={16} color={Colors.primary} />
        </View>
      )}
      {!rightText && (
        <Ionicons name="chevron-forward" size={20} color={Colors.muted} style={menuStyles.chevron} />
      )}
    </TouchableOpacity>
  );
}

const menuStyles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  label: {
    flex: 1,
    fontSize: 16,
    color: Colors.foreground,
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rightText: {
    fontSize: 14,
    color: Colors.primary,
  },
  chevron: {
    marginLeft: 'auto',
  },
});

export default function MenuScreen() {
  const router = useRouter();
  const { user, logout, loading, refreshUser } = useAuth();
  const { lang, setLang, t } = useLang();
  const [refreshing, setRefreshing] = useState(false);
  const [myTagPoints, setMyTagPoints] = useState<any[]>([]);
  const [showLangModal, setShowLangModal] = useState(false);
  const [isRefreshingUser, setIsRefreshingUser] = useState(false);

  // Fallback: si le token est en storage mais user pas encore résolu, on rafraîchit
  useEffect(() => {
    if (!loading && !user) {
      setIsRefreshingUser(true);
      refreshUser().finally(() => setIsRefreshingUser(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  // Reload when screen comes back into focus (e.g. after deletion)
  const navigation = useNavigation();
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => { if (user) loadData(); });
    return unsub;
  }, [navigation, user]);

  const loadData = async () => {
    try {
      const points = await api.get('/tag-points/mine');
      setMyTagPoints(points || []);
    } catch {}
    finally { setRefreshing(false); }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, []);

  const formatDistance = (distanceMeters?: number) => {
    if (!distanceMeters) return '---';
    if (distanceMeters < 1000) {
      return `${Math.round(distanceMeters)}M`;
    }
    return `${(distanceMeters / 1000).toFixed(1)}KM`;
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  if (loading || isRefreshingUser) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="person-outline" size={48} color={Colors.muted} />
          <Text style={styles.emptyText}>Veuillez vous connecter</Text>
        </View>
      </SafeAreaView>
    );
  }

  const initial = user.name?.charAt(0)?.toUpperCase() || '?';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft} />
        <Text style={styles.headerTitle}>Menu</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerIcon}>
            <Ionicons name="location" size={24} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerIcon}>
            <Ionicons name="search" size={24} color={Colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {/* User Profile Card */}
        <TouchableOpacity 
          style={styles.profileCard}
          onPress={() => router.push('/(main)/profile')}
          activeOpacity={0.8}
        >
          <View style={styles.avatar}>
            {user.picture ? (
              <Image source={{ uri: user.picture }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{initial}</Text>
            )}
          </View>
          <Text style={styles.userName}>{user.name}</Text>
        </TouchableOpacity>

        {/* Action Cards */}
        <View style={styles.actionCards}>
          <TouchableOpacity style={styles.actionCard} activeOpacity={0.7} onPress={() => router.push('/saved' as any)} testID="saved-nav-btn">
            <Text style={styles.actionCardLabel}>ENREGISTRÉS</Text>
            <Ionicons name="bookmark-outline" size={28} color={Colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} activeOpacity={0.7} onPress={() => router.push('/events' as any)} testID="events-nav-btn">
            <Text style={styles.actionCardLabel}>ÉVÈNEMENTS</Text>
            <Ionicons name="calendar-outline" size={28} color={Colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* My Tag Points */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>my tag points</Text>
          {myTagPoints.length === 0 ? (
            <Text style={styles.emptySection}>Aucun tag point créé</Text>
          ) : (
            <>
              {myTagPoints.slice(0, 3).map((pt) => (
                <TagPointRow
                  key={pt.point_id}
                  image={pt.image_url}
                  title={pt.title || 'Sans titre'}
                  author={user.name || 'Anonyme'}
                  distance={formatDistance(pt.distance)}
                  rating={pt.rating || 3}
                  onPress={() => router.push(`/tag-point/${pt.point_id}`)}
                />
              ))}
              {myTagPoints.length > 3 && (
                <TouchableOpacity
                  style={styles.seeMore}
                  onPress={() => router.push('/my-tag-points' as any)}
                  testID="see-more-tagpoints-btn"
                >
                  <Text style={styles.seeMoreText}>Voir plus</Text>
                  <Ionicons name="chevron-forward" size={18} color={Colors.primary} />
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        {/* Menu Items */}
        <View style={styles.menuSection}>
          {user.role === 'admin' && (
            <MenuItem
              icon="settings-outline"
              label="Paramètres administrateur"
              onPress={() => router.push('/(main)/admin')}
            />
          )}
          <MenuItem
            icon="settings-outline"
            label="Gérer mes adresses"
            onPress={() => {}}
          />
          <MenuItem
            icon="language-outline"
            label="Langue"
            rightText={lang === 'fr' ? 'Français' : 'English'}
            onPress={() => setShowLangModal(true)}
          />
        </View>

        {/* Logout Button */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Déconnexion</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Language Modal */}
      <Modal visible={showLangModal} transparent animationType="fade">
        <TouchableOpacity 
          style={styles.modalOverlay} 
          onPress={() => setShowLangModal(false)}
          activeOpacity={1}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Choisir la langue</Text>
            <TouchableOpacity
              style={[styles.langOption, lang === 'fr' && styles.langOptionActive]}
              onPress={() => { setLang('fr'); setShowLangModal(false); }}
            >
              <Text style={styles.langOptionText}>Français</Text>
              {lang === 'fr' && <Ionicons name="checkmark" size={20} color={Colors.primary} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.langOption, lang === 'en' && styles.langOptionActive]}
              onPress={() => { setLang('en'); setShowLangModal(false); }}
            >
              <Text style={styles.langOptionText}>English</Text>
              {lang === 'en' && <Ionicons name="checkmark" size={20} color={Colors.primary} />}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  headerLeft: {
    width: 60,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.primary,
  },
  headerRight: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  headerIcon: {
    padding: 4,
  },
  content: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    padding: Spacing.md,
    paddingBottom: 40,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.full,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.foreground,
  },
  actionCards: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  actionCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  actionCardLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.muted,
    letterSpacing: 1,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.foreground,
    marginBottom: Spacing.sm,
  },
  emptySection: {
    fontSize: 14,
    color: Colors.muted,
    fontStyle: 'italic',
    paddingVertical: Spacing.md,
  },
  seeMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    gap: 4,
  },
  seeMoreText: {
    fontSize: 15,
    color: Colors.primary,
    fontWeight: '600',
  },
  menuSection: {
    marginTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  logoutBtn: {
    backgroundColor: Colors.header,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.primary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    color: Colors.muted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  modalCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 320,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  langOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
  },
  langOptionActive: {
    backgroundColor: Colors.primaryLight,
  },
  langOptionText: {
    fontSize: 16,
    color: Colors.foreground,
  },
});
