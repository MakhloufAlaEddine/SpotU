import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../constants/Colors';

interface CompletionStep {
  id: string;
  label: string;
  icon: string;
  done: boolean;
  onPress: () => void;
}

interface Props {
  profile: any;
  spotYouCount: number;
  interests: any[];
  hasBooking: boolean;
  isCommunityMember: boolean;
  hasParticipation: boolean;
  onEditProfile: () => void;
  onCreateSpotYou: () => void;
  onExplore: () => void;
}

export function ProfileCompletionBar({
  profile, spotYouCount, interests, hasBooking, isCommunityMember, hasParticipation,
  onEditProfile, onCreateSpotYou, onExplore,
}: Props) {
  const steps: CompletionStep[] = [
    { id: 'photo',       label: 'Photo',                   icon: 'camera-outline',     done: !!profile.picture,      onPress: onEditProfile },
    { id: 'bio',         label: 'Bio',                     icon: 'text-outline',       done: !!profile.bio?.trim(),  onPress: onEditProfile },
    { id: 'interests',   label: "Centres d'intérêt",       icon: 'heart-outline',      done: interests.length > 0,   onPress: onEditProfile },
    { id: 'spotyou',     label: 'SpotYou',                 icon: 'location-outline',   done: spotYouCount > 0,       onPress: onCreateSpotYou },
    { id: 'booking',     label: 'Réservation',             icon: 'calendar-outline',   done: hasBooking,             onPress: onExplore },
    { id: 'community',   label: 'Communauté',              icon: 'people-outline',     done: isCommunityMember,      onPress: onExplore },
    { id: 'participate', label: '1ère participation',      icon: 'checkmark-circle-outline', done: hasParticipation, onPress: onExplore },
  ];
  const doneCount = steps.filter(s => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);
  const isComplete = pct === 100;

  return (
    <View style={st.card} testID="profile-completion-bar">
      <View style={st.headerRow}>
        <View style={st.headerLeft}>
          <Ionicons name={isComplete ? 'trophy-outline' : 'ribbon-outline'} size={15} color={Colors.primary} />
          <Text style={st.title}>
            {isComplete ? 'Profil complété à ' : 'Profil complété à '}
            <Text style={st.pct}>{pct}%</Text>
          </Text>
        </View>
        <Text style={[st.remaining, isComplete && st.remainingDone]}>
          {isComplete ? 'Complet !' : `${steps.length - doneCount} restant${steps.length - doneCount > 1 ? 's' : ''}`}
        </Text>
      </View>
      <View style={st.track}>
        <View style={[st.fill, { width: `${pct}%` as any }]} />
      </View>
      <View style={st.grid}>
        {steps.map(step => (
          <TouchableOpacity
            key={step.id}
            style={[st.step, step.done && st.stepDone]}
            onPress={step.done ? undefined : step.onPress}
            activeOpacity={step.done ? 1 : 0.75}
            testID={`completion-step-${step.id}`}
          >
            <View style={[st.stepIconWrap, step.done && st.stepIconWrapDone]}>
              <Ionicons
                name={step.done ? 'checkmark' : step.icon as any}
                size={13}
                color={step.done ? Colors.primary : Colors.muted}
              />
            </View>
            <Text style={[st.stepLabel, step.done && st.stepLabelDone]} numberOfLines={1}>
              {step.label}
            </Text>
            {!step.done && <Ionicons name="chevron-forward" size={11} color={Colors.muted} />}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.md, marginBottom: Spacing.md,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.primary + '35',
    padding: 14, gap: 10,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  pct: { color: Colors.primary, fontWeight: '800' },
  remaining: { fontSize: 11, color: Colors.muted },
  remainingDone: { color: Colors.primary, fontWeight: '700' },
  track: { height: 5, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  step: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.background,
    borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: Colors.border,
    flex: 1, minWidth: '45%',
  },
  stepDone: { borderColor: Colors.primary + '40', backgroundColor: Colors.primary + '08' },
  stepIconWrap: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  stepIconWrapDone: { backgroundColor: Colors.primary + '25' },
  stepLabel: { flex: 1, fontSize: 12, fontWeight: '600', color: Colors.muted },
  stepLabelDone: { color: Colors.foreground },
});
