import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ActivityIndicator, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { COVER_H, TEAL_DIM, TEAL_BORDER, Badge } from './profileUtils';

interface ProfileHeroProps {
  profile: any;
  isOwnProfile: boolean;
  isCoach: boolean;
  me: any;
  badge: Badge | null;
  avgRating: number | null;
  reviewsCount: number;
  isFollowing: boolean;
  followLoading: boolean;
  followersCount: number;
  followingCount: number;
  spotYouCount: number;
  uploadingCover: boolean;
  // Animated values
  animImgWidth: Animated.AnimatedMultiplication;
  animImgHeight: Animated.AnimatedMultiplication;
  animImgLeft: Animated.AnimatedMultiplication;
  repoTopAnim: Animated.Value;
  // Callbacks
  onFollow: () => void;
  onCoverEdit: () => void;
  onFollowersPress: () => void;
  onFollowingPress: () => void;
}

export function ProfileHero({
  profile, isOwnProfile, isCoach, me, badge, avgRating, reviewsCount,
  isFollowing, followLoading, followersCount, followingCount, spotYouCount,
  uploadingCover,
  animImgWidth, animImgHeight, animImgLeft, repoTopAnim,
  onFollow, onCoverEdit, onFollowersPress, onFollowingPress,
}: ProfileHeroProps) {
  return (
    <View style={st.hero} testID="user-profile-hero">
      {/* COVER PHOTO */}
      <View style={st.coverWrap}>
        {profile.cover_picture ? (
          <Animated.Image
            source={{ uri: profile.cover_picture }}
            style={[st.coverImg, {
              width: animImgWidth, height: animImgHeight,
              left: animImgLeft, top: repoTopAnim,
            }]}
          />
        ) : (
          <View style={st.coverPlaceholder} />
        )}
        <View style={st.coverOverlay} />
        {isOwnProfile && (
          <TouchableOpacity style={st.coverEditBtn} onPress={onCoverEdit}
            disabled={uploadingCover} testID="cover-edit-btn" activeOpacity={0.85}>
            {uploadingCover
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="camera" size={18} color="#fff" />}
          </TouchableOpacity>
        )}
      </View>

      {/* AVATAR + FOLLOW */}
      <View style={st.avatarRow}>
        <View style={st.avatarWrap}>
          {profile.picture
            ? <Image source={{ uri: profile.picture }} style={st.avatarImg} />
            : <View style={st.avatarPlaceholder}>
                <Text style={st.avatarInitial}>{profile.name?.charAt(0)?.toUpperCase() || '?'}</Text>
              </View>}
          {isCoach && profile.is_coach_verified && (
            <View style={st.verifiedDot} testID="verified-badge">
              <Ionicons name="checkmark" size={10} color="#0A0A0A" />
            </View>
          )}
        </View>
        <View style={st.heroActions}>
          {me && !isOwnProfile && (
            <TouchableOpacity
              style={[st.followBtn, isFollowing && st.followBtnActive]}
              onPress={onFollow} disabled={followLoading}
              testID="follow-btn" activeOpacity={0.8}>
              {followLoading
                ? <ActivityIndicator size="small" color={isFollowing ? Colors.primary : '#0A0A0A'} />
                : <>
                    <Ionicons name={isFollowing ? 'checkmark-circle' : 'person-add-outline'} size={14}
                      color={isFollowing ? Colors.primary : '#0A0A0A'} />
                    <Text style={[st.followBtnText, isFollowing && st.followBtnTextActive]}>
                      {isFollowing ? 'Abonné' : 'Suivre'}
                    </Text>
                  </>}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* NAME + BADGES + STATS */}
      <View style={st.heroInfo}>
        <View style={st.nameRow}>
          <Text style={st.name} testID="user-profile-name">{profile.name}</Text>
          {badge && (
            <View style={[st.achievementBadge, { backgroundColor: badge.bg, borderColor: badge.color + '44' }]}
              testID="achievement-badge">
              <Ionicons name={badge.icon as any} size={11} color={badge.color} />
              <Text style={[st.achievementText, { color: badge.color }]}>{badge.label}</Text>
            </View>
          )}
        </View>
        <View style={st.badgeRow}>
          <View style={[st.roleBadge, isCoach && st.roleBadgeCoach]}>
            <Ionicons name={isCoach ? 'trophy-outline' : 'person-outline'} size={11}
              color={isCoach ? Colors.primary : Colors.muted} />
            <Text style={[st.roleBadgeText, isCoach && { color: Colors.primary }]}>
              {isCoach ? 'Coach' : 'Membre'}
            </Text>
          </View>
          {avgRating != null && (
            <View style={st.ratingBadge} testID="rating-badge">
              <Ionicons name="star" size={11} color="#FFD700" />
              <Text style={st.ratingText}>{avgRating} ({reviewsCount})</Text>
            </View>
          )}
        </View>
        {profile.bio ? <Text style={st.bio}>{profile.bio}</Text> : null}
        <View style={st.statsInline} testID="profile-stats">
          <TouchableOpacity onPress={onFollowersPress} activeOpacity={0.7}
            testID="followers-count-btn" style={st.statInlineTap}>
            <Text style={st.statInlineNum}>{followersCount}</Text>
            <Text style={st.statInlineLbl}> abonnés</Text>
          </TouchableOpacity>
          <Text style={st.statInlineSep}> · </Text>
          <TouchableOpacity onPress={onFollowingPress} activeOpacity={0.7}
            testID="following-count-btn" style={st.statInlineTap}>
            <Text style={st.statInlineNum}>{followingCount}</Text>
            <Text style={st.statInlineLbl}> abonnements</Text>
          </TouchableOpacity>
          <Text style={st.statInlineSep}> · </Text>
          <Text style={st.statInlineNum}>{spotYouCount}</Text>
          <Text style={st.statInlineLbl}> SpotYou</Text>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  hero: { marginBottom: 4 },
  coverWrap: { width: '100%' as any, height: COVER_H, overflow: 'hidden', position: 'relative' as any },
  coverImg: { position: 'absolute' as any, resizeMode: 'cover' },
  coverPlaceholder: { width: '100%' as any, height: COVER_H, backgroundColor: '#0D2420' },
  coverOverlay: { position: 'absolute' as any, bottom: 0, left: 0, right: 0, height: 80, backgroundColor: 'transparent' },
  coverEditBtn: {
    position: 'absolute' as any, bottom: 12, right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 22,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  avatarRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: 16, marginTop: -52, marginBottom: 10,
  },
  avatarWrap: { position: 'relative' as any },
  avatarImg: {
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 4, borderColor: Colors.background,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8,
  },
  avatarPlaceholder: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: TEAL_DIM, borderWidth: 4, borderColor: Colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 38, fontWeight: '800', color: Colors.primary },
  verifiedDot: {
    position: 'absolute' as any, bottom: 4, right: 4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.primary, borderWidth: 2, borderColor: Colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  heroActions: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  followBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9,
  },
  followBtnActive: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.primary },
  followBtnText: { fontSize: 13, fontWeight: '800', color: '#0A0A0A' },
  followBtnTextActive: { color: Colors.primary },
  heroInfo: { paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: Colors.secondary },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as any, marginBottom: 6 },
  name: { fontSize: 22, fontWeight: '800', color: Colors.foreground, letterSpacing: -0.5 },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.secondary, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4,
  },
  roleBadgeCoach: { backgroundColor: TEAL_DIM },
  roleBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.muted },
  ratingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,215,0,0.12)', borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)',
  },
  ratingText: { fontSize: 11, fontWeight: '600', color: '#FFD700' },
  achievementBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1,
  },
  achievementText: { fontSize: 11, fontWeight: '700' },
  bio: { fontSize: 14, color: Colors.muted, lineHeight: 20, marginBottom: 10 },
  statsInline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' as any },
  statInlineTap: { flexDirection: 'row', alignItems: 'center' },
  statInlineNum: { fontSize: 14, fontWeight: '800', color: Colors.foreground },
  statInlineLbl: { fontSize: 13, color: Colors.muted },
  statInlineSep: { fontSize: 13, color: Colors.muted },
});
