/**
 * StepAcces — Step 5 du formulaire de création / mise à jour SpotYou
 * Permet de configurer : visibilité, mode d'admission, permissions d'invitation.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/Colors';

type VisibilityType = 'public' | 'private';
type JoinMode = 'open' | 'admin_approval' | 'members_approval';
type InvitePermissions = 'admin_only' | 'members_only' | 'admin_and_members';

interface Props {
  visibilityType: VisibilityType;
  setVisibilityType: (v: VisibilityType) => void;
  joinMode: JoinMode;
  setJoinMode: (v: JoinMode) => void;
  invitePermissions: InvitePermissions;
  setInvitePermissions: (v: InvitePermissions) => void;
}

interface OptionProps {
  selected: boolean;
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  recommended?: boolean;
  testID?: string;
}

function OptionRow({ selected, onPress, icon, label, description, recommended, testID }: OptionProps) {
  return (
    <TouchableOpacity
      style={[s.option, selected && s.optionSelected]}
      onPress={onPress}
      activeOpacity={0.8}
      testID={testID}
    >
      <View style={[s.optionIcon, selected && s.optionIconSelected]}>
        <Ionicons name={icon} size={18} color={selected ? Colors.background : Colors.muted} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[s.optionLabel, selected && s.optionLabelSelected]}>{label}</Text>
          {recommended && (
            <View style={s.recBadge}>
              <Text style={s.recBadgeText}>Recommandé</Text>
            </View>
          )}
        </View>
        <Text style={s.optionDesc}>{description}</Text>
      </View>
      <View style={[s.radio, selected && s.radioSelected]}>
        {selected && <View style={s.radioDot} />}
      </View>
    </TouchableOpacity>
  );
}

export function StepAcces({ visibilityType, setVisibilityType, joinMode, setJoinMode, invitePermissions, setInvitePermissions }: Props) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>

      {/* ── Visibilité ── */}
      <Text style={s.sectionTitle}>Visibilité</Text>
      <Text style={s.sectionSubtitle}>Qui peut voir et découvrir ce SpotYou ?</Text>

      <OptionRow
        selected={visibilityType === 'public'}
        onPress={() => { setVisibilityType('public'); setJoinMode('open'); }}
        icon="globe-outline"
        label="Public"
        description="Visible de tous. Favorise la croissance de votre communauté."
        recommended
        testID="visibility-public"
      />
      <OptionRow
        selected={visibilityType === 'private'}
        onPress={() => { setVisibilityType('private'); if (joinMode === 'open') setJoinMode('admin_approval'); }}
        icon="lock-closed-outline"
        label="Privé"
        description="Accès restreint — vous contrôlez qui rejoint la communauté."
        testID="visibility-private"
      />

      {/* ── Mode d'admission (seulement si privé) ── */}
      {visibilityType === 'private' && (
        <>
          <View style={s.divider} />
          <Text style={s.sectionTitle}>Mode d'admission</Text>
          <Text style={s.sectionSubtitle}>Comment les nouvelles demandes sont-elles traitées ?</Text>

          <OptionRow
            selected={joinMode === 'admin_approval'}
            onPress={() => setJoinMode('admin_approval')}
            icon="shield-checkmark-outline"
            label="Validation admin"
            description="Chaque demande doit être acceptée par vous. Contrôle total."
            recommended
            testID="join-mode-admin"
          />
          <OptionRow
            selected={joinMode === 'members_approval'}
            onPress={() => setJoinMode('members_approval')}
            icon="people-outline"
            label="Validation membres"
            description="Tout membre peut accepter une demande. 1 validation suffit."
            testID="join-mode-members"
          />
        </>
      )}

      {/* ── Invitations ── */}
      <View style={s.divider} />
      <Text style={s.sectionTitle}>Invitations</Text>
      <Text style={s.sectionSubtitle}>Qui peut inviter de nouveaux membres ?</Text>

      <OptionRow
        selected={invitePermissions === 'admin_only'}
        onPress={() => setInvitePermissions('admin_only')}
        icon="person-outline"
        label="Admin uniquement"
        description="Seul vous pouvez inviter des personnes à rejoindre."
        recommended
        testID="invite-admin-only"
      />
      <OptionRow
        selected={invitePermissions === 'members_only'}
        onPress={() => setInvitePermissions('members_only')}
        icon="people-circle-outline"
        label="Membres uniquement"
        description="Tous les membres peuvent inviter (sans vous)."
        testID="invite-members-only"
      />
      <OptionRow
        selected={invitePermissions === 'admin_and_members'}
        onPress={() => setInvitePermissions('admin_and_members')}
        icon="globe-outline"
        label="Admin et membres"
        description="Tout le monde dans la communauté peut inviter."
        testID="invite-admin-and-members"
      />

      {/* Info anti-friction */}
      <View style={s.infoBox}>
        <Ionicons name="information-circle-outline" size={16} color={Colors.primary} />
        <Text style={s.infoText}>
          Ces réglages peuvent être modifiés à tout moment depuis la page de votre SpotYou.
        </Text>
      </View>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { paddingHorizontal: Spacing.md, paddingBottom: 40, gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground, marginTop: Spacing.md },
  sectionSubtitle: { fontSize: 13, color: Colors.muted, marginBottom: 4 },
  divider: { height: 1, backgroundColor: Colors.border, marginTop: Spacing.sm },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.card, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md,
  },
  optionSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10',
  },
  optionIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  optionIconSelected: { backgroundColor: Colors.primary },
  optionLabel: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  optionLabelSelected: { color: Colors.primary },
  optionDesc: { fontSize: 12, color: Colors.muted, lineHeight: 16 },
  radio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radioSelected: { borderColor: Colors.primary },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  recBadge: {
    backgroundColor: Colors.primary + '20', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  recBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.primary },
  infoBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: Colors.primary + '10', borderRadius: Radius.md,
    padding: Spacing.md, marginTop: Spacing.sm,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  infoText: { flex: 1, fontSize: 12, color: Colors.muted, lineHeight: 18 },
});
