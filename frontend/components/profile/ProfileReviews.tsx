import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { UserAvatar } from '../UserAvatar';
import { StarRow, TEAL_DIM, TEAL_BORDER } from './profileUtils';

interface Props {
  reviews: any[];
  myReview: any;
  editingReview: boolean;
  myRating: number;
  myComment: string;
  submitting: boolean;
  isOwnProfile: boolean;
  canWriteNewReview: boolean;
  canEditReview: boolean;
  avgRating: number | null;
  showAllReviews: boolean;
  onSetMyRating: (n: number) => void;
  onSetMyComment: (s: string) => void;
  onSubmitReview: () => void;
  onEditReview: () => void;
  onCancelEdit: () => void;
  onToggleShowAll: () => void;
}

const REVIEWS_PREVIEW = 3;

export function ProfileReviews({
  reviews, myReview, editingReview, myRating, myComment, submitting,
  isOwnProfile, canWriteNewReview, canEditReview, avgRating, showAllReviews,
  onSetMyRating, onSetMyComment, onSubmitReview, onEditReview, onCancelEdit, onToggleShowAll,
}: Props) {
  const displayedReviews = showAllReviews ? reviews : reviews.slice(0, REVIEWS_PREVIEW);

  return (
    <View style={st.section} testID="reviews-section">
      {/* Header */}
      <View style={[st.reviewsHeader, { marginBottom: 14 }]}>
        <View style={st.sectionHeader}>
          <View style={st.sectionAccent} />
          <Ionicons name="star-outline" size={14} color={Colors.primary} />
          <Text style={st.sectionTitle}>Avis{reviews.length > 0 ? ` (${reviews.length})` : ''}</Text>
        </View>
        {avgRating != null && (
          <View style={st.avgRatingRow}>
            <StarRow rating={Math.round(avgRating)} size={13} />
            <Text style={st.avgRatingText}>{avgRating}</Text>
          </View>
        )}
      </View>

      {/* New review form */}
      {(canWriteNewReview || canEditReview) && (
        <View style={st.reviewForm} testID="review-form">
          <Text style={st.reviewFormTitle}>{myReview ? 'Modifier mon avis' : 'Laisser un avis'}</Text>
          <View style={st.starPicker}>
            <StarRow rating={myRating} size={30} onPress={onSetMyRating} />
          </View>
          <TextInput
            style={st.reviewInput} value={myComment} onChangeText={onSetMyComment}
            placeholder="Partagez votre expérience... (optionnel)"
            placeholderTextColor={Colors.muted} multiline numberOfLines={3}
            textAlignVertical="top" testID="review-comment-input"
          />
          <View style={st.reviewFormActions}>
            {editingReview && (
              <TouchableOpacity style={st.cancelBtn} onPress={onCancelEdit}>
                <Text style={st.cancelBtnText}>Annuler</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[st.submitBtn, submitting && st.submitBtnDisabled, editingReview && { flex: 1 }]}
              onPress={onSubmitReview} disabled={submitting} testID="submit-review-btn">
              {submitting
                ? <ActivityIndicator size="small" color={Colors.background} />
                : <>
                    <Ionicons name="send" size={14} color={Colors.background} />
                    <Text style={st.submitBtnText}>{myReview ? 'Mettre à jour' : 'Publier'}</Text>
                  </>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* My review banner */}
      {myReview && !editingReview && !isOwnProfile && (
        <View style={st.myReviewBanner} testID="my-review-banner">
          <View style={{ flex: 1 }}>
            <Text style={st.myReviewLabel}>Mon avis</Text>
            <StarRow rating={myReview.rating} size={13} />
            {myReview.comment ? <Text style={st.myReviewComment} numberOfLines={2}>{myReview.comment}</Text> : null}
          </View>
          <TouchableOpacity style={st.editReviewBtn} onPress={onEditReview} testID="edit-review-btn">
            <Ionicons name="pencil" size={13} color={Colors.primary} />
            <Text style={st.editReviewBtnText}>Modifier</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Reviews list */}
      {reviews.length === 0 ? (
        <View style={st.noReviews} testID="no-reviews">
          <View style={st.noReviewsStars}>
            {[1,2,3,4,5].map(i => <Ionicons key={i} name="star-outline" size={18} color={Colors.border} />)}
          </View>
          <Text style={st.noReviewsTitle}>
            {isOwnProfile ? "Pas encore d'avis" : "Soyez le premier à laisser un avis"}
          </Text>
          <Text style={st.noReviewsDesc}>
            {isOwnProfile
              ? "Participez à des activités et échangez avec la communauté pour recevoir vos premiers avis."
              : "Rejoignez une session et partagez votre expérience avec la communauté."}
          </Text>
        </View>
      ) : (
        <>
          {displayedReviews
            .filter(r => !myReview || r.review_id !== myReview.review_id)
            .map((r: any) => (
              <View key={r.review_id} style={st.reviewCard} testID={`review-${r.review_id}`}>
                <View style={st.reviewHeader}>
                  <View style={st.reviewerInfo}>
                    <UserAvatar uri={r.reviewer_picture} name={r.reviewer_name} size={36} />
                    <View>
                      <Text style={st.reviewerName}>{r.reviewer_name}</Text>
                      <Text style={st.reviewDate}>
                        {new Date(r.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                    </View>
                  </View>
                  <StarRow rating={r.rating} size={13} />
                </View>
                {r.comment ? <Text style={st.reviewComment}>{r.comment}</Text> : null}
              </View>
            ))}
          {reviews.length > REVIEWS_PREVIEW && (
            <TouchableOpacity style={st.seeMoreBtn} onPress={onToggleShowAll} testID="see-more-reviews-btn">
              <Text style={st.seeMoreText}>
                {showAllReviews ? 'Voir moins' : `Voir ${reviews.length - REVIEWS_PREVIEW > 1 ? 'les' : 'le'} ${reviews.length - REVIEWS_PREVIEW} autre${reviews.length - REVIEWS_PREVIEW > 1 ? 's' : ''} avis`}
              </Text>
              <Ionicons name={showAllReviews ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionAccent: { width: 3, height: 16, borderRadius: 2, backgroundColor: Colors.primary },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.foreground, textTransform: 'uppercase', letterSpacing: 1.2 },
  reviewsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  avgRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avgRatingText: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  reviewForm: {
    backgroundColor: Colors.card, borderRadius: Radius.xl, padding: Spacing.md,
    marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  reviewFormTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground, marginBottom: 12 },
  starPicker: { marginBottom: 12 },
  reviewInput: {
    backgroundColor: Colors.background, borderRadius: 10, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: Colors.foreground, minHeight: 80, marginBottom: 12,
  },
  reviewFormActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    borderRadius: Radius.full, paddingVertical: 11, paddingHorizontal: 18,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: Colors.muted },
  submitBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 12,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { fontSize: 14, fontWeight: '700', color: Colors.background },
  myReviewBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: TEAL_DIM, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: TEAL_BORDER, marginBottom: Spacing.sm,
  },
  myReviewLabel: { fontSize: 11, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  myReviewComment: { fontSize: 12, color: Colors.muted, marginTop: 4 },
  editReviewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.background, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: TEAL_BORDER,
  },
  editReviewBtnText: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  reviewCard: {
    backgroundColor: Colors.card, borderRadius: Radius.xl, padding: Spacing.md,
    marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border,
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  reviewerInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  reviewerName: { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  reviewDate: { fontSize: 11, color: Colors.muted, marginTop: 1 },
  reviewComment: { fontSize: 13, color: Colors.muted, lineHeight: 18 },
  seeMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Radius.lg, borderWidth: 1, borderColor: TEAL_BORDER,
    backgroundColor: TEAL_DIM, marginTop: 4,
  },
  seeMoreText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  noReviews: { paddingVertical: 24, alignItems: 'center', gap: 10 },
  noReviewsStars: { flexDirection: 'row', gap: 5, marginBottom: 4 },
  noReviewsTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground, textAlign: 'center' },
  noReviewsDesc: { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 19, maxWidth: 280 },
});
