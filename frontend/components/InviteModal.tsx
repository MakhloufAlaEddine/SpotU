import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  FlatList, ActivityIndicator, Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { Colors, Spacing, Radius } from '../constants/Colors';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface UserResult {
  user_id: string;
  name: string;
  picture?: string | null;
  role?: string;
  is_social?: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  pointId: string;
  pointTitle: string;
  /** Identifiants des membres déjà acceptés (pour les griser) */
  existingMemberIds?: string[];
}

// ─── Component ─────────────────────────────────────────────────────────────────
export function InviteModal({ visible, onClose, pointId, pointTitle, existingMemberIds = [] }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const debounceRef = useRef<any>(null);

  const reset = () => {
    setQuery('');
    setResults([]);
    setSelectedUser(null);
    setSuccess(false);
    setErrorMsg('');
  };

  const handleClose = () => { reset(); onClose(); };

  const search = useCallback((text: string) => {
    setQuery(text);
    setErrorMsg('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim() || text.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.get(`/users/search?q=${encodeURIComponent(text.trim())}`);
        setResults(Array.isArray(data) ? data : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
  }, []);

  const sendInvite = async () => {
    if (!selectedUser) return;
    setSending(true);
    setErrorMsg('');
    try {
      await api.post(`/tag-points/${pointId}/invite`, { invited_user_id: selectedUser.user_id });
      setSuccess(true);
      setTimeout(() => { reset(); onClose(); }, 1800);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Erreur lors de l\'envoi');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.overlay}>
          <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={handleClose} />
          <View style={s.sheet}>

            {/* Header */}
            <View style={s.header}>
              <View>
                <Text style={s.title}>Inviter un membre</Text>
                <Text style={s.subtitle} numberOfLines={1}>{pointTitle}</Text>
              </View>
              <TouchableOpacity onPress={handleClose} testID="close-invite-modal">
                <Ionicons name="close" size={22} color={Colors.foreground} />
              </TouchableOpacity>
            </View>

            {/* Succès */}
            {success ? (
              <View style={s.successBox} testID="invite-success">
                <Ionicons name="checkmark-circle" size={40} color={Colors.primary} />
                <Text style={s.successTitle}>Invitation envoyée !</Text>
                <Text style={s.successSub}>
                  {selectedUser?.name} recevra une notification pour rejoindre ce SpotYou.
                </Text>
              </View>
            ) : (
              <>
                {/* Utilisateur sélectionné */}
                {selectedUser ? (
                  <View style={s.selectedBox} testID="selected-user-box">
                    <View style={s.selectedLeft}>
                      <View style={s.avatar}>
                        {selectedUser.picture
                          ? <Image source={{ uri: selectedUser.picture }} style={{ width: '100%', height: '100%' }} />
                          : <Text style={s.avatarTxt}>{selectedUser.name?.charAt(0)?.toUpperCase()}</Text>}
                      </View>
                      <View>
                        <Text style={s.selectedName}>{selectedUser.name}</Text>
                        {selectedUser.role === 'coach' && (
                          <Text style={s.coachLabel}>Coach</Text>
                        )}
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => setSelectedUser(null)} testID="deselect-user">
                      <Ionicons name="close-circle" size={20} color={Colors.muted} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  /* Champ de recherche */
                  <View style={s.searchBox}>
                    <Ionicons name="search" size={17} color={Colors.muted} />
                    <TextInput
                      style={s.searchInput}
                      placeholder="Rechercher par nom…"
                      placeholderTextColor={Colors.muted}
                      value={query}
                      onChangeText={search}
                      autoFocus
                      testID="invite-search-input"
                    />
                    {searching && <ActivityIndicator size="small" color={Colors.primary} />}
                    {query.length > 0 && !searching && (
                      <TouchableOpacity onPress={() => { setQuery(''); setResults([]); }}>
                        <Ionicons name="close" size={16} color={Colors.muted} />
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* Résultats */}
                {!selectedUser && results.length > 0 && (
                  <FlatList
                    data={results}
                    keyExtractor={u => u.user_id}
                    style={s.resultList}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item }) => {
                      const isAlreadyMember = existingMemberIds.includes(item.user_id);
                      return (
                        <TouchableOpacity
                          style={[s.resultRow, isAlreadyMember && { opacity: 0.45 }]}
                          onPress={() => !isAlreadyMember && setSelectedUser(item)}
                          disabled={isAlreadyMember}
                          testID={`user-result-${item.user_id}`}
                        >
                          <View style={s.avatar}>
                            {item.picture
                              ? <Image source={{ uri: item.picture }} style={{ width: '100%', height: '100%' }} />
                              : <Text style={s.avatarTxt}>{item.name?.charAt(0)?.toUpperCase()}</Text>}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={s.resultName} numberOfLines={1}>{item.name}</Text>
                            {item.is_social && !isAlreadyMember && (
                              <Text style={s.socialLabel}>Dans votre réseau</Text>
                            )}
                            {isAlreadyMember && (
                              <Text style={s.alreadyMemberLabel}>Déjà membre</Text>
                            )}
                          </View>
                          {item.role === 'coach' && (
                            <View style={s.coachBadge}><Text style={s.coachBadgeTxt}>Coach</Text></View>
                          )}
                        </TouchableOpacity>
                      );
                    }}
                  />
                )}

                {/* Aucun résultat */}
                {!selectedUser && query.length >= 2 && !searching && results.length === 0 && (
                  <Text style={s.noResult} testID="no-results">Aucun utilisateur trouvé pour « {query} »</Text>
                )}

                {/* Message d'erreur */}
                {errorMsg ? (
                  <View style={s.errorBox} testID="invite-error">
                    <Ionicons name="warning-outline" size={15} color="#EF4444" />
                    <Text style={s.errorTxt}>{errorMsg}</Text>
                  </View>
                ) : null}

                {/* Bouton confirmation */}
                {selectedUser && (
                  <TouchableOpacity
                    style={[s.confirmBtn, sending && { opacity: 0.6 }]}
                    onPress={sendInvite}
                    disabled={sending}
                    testID="confirm-invite-btn"
                  >
                    {sending
                      ? <ActivityIndicator color={Colors.background} size="small" />
                      : <>
                          <Ionicons name="paper-plane-outline" size={16} color={Colors.background} />
                          <Text style={s.confirmBtnTxt}>Envoyer l'invitation</Text>
                        </>
                    }
                  </TouchableOpacity>
                )}
              </>
            )}

            <View style={{ height: 20 }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  overlay:       { flex: 1, justifyContent: 'flex-end' },
  backdrop:      { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet:         { backgroundColor: Colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: Spacing.md, minHeight: 280 },
  header:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.md },
  title:         { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  subtitle:      { fontSize: 12, color: Colors.muted, marginTop: 2 },

  searchBox:     { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 10, gap: 8, marginBottom: Spacing.sm },
  searchInput:   { flex: 1, color: Colors.foreground, fontSize: 14 },

  resultList:    { maxHeight: 260, marginBottom: Spacing.sm },
  resultRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  resultName:    { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  socialLabel:   { fontSize: 11, color: Colors.primary, marginTop: 1 },
  alreadyMemberLabel: { fontSize: 11, color: Colors.muted, marginTop: 1 },
  noResult:      { textAlign: 'center', color: Colors.muted, fontSize: 13, paddingVertical: Spacing.md },

  avatar:        { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.card, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  avatarTxt:     { fontSize: 14, fontWeight: '700', color: Colors.primary },

  coachBadge:    { backgroundColor: Colors.primary + '20', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  coachBadgeTxt: { fontSize: 10, color: Colors.primary, fontWeight: '600' },
  coachLabel:    { fontSize: 11, color: Colors.primary },

  selectedBox:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.primary + '15', borderRadius: Radius.md, padding: Spacing.sm, marginBottom: Spacing.sm },
  selectedLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectedName:  { fontSize: 14, fontWeight: '700', color: Colors.foreground },

  confirmBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: Radius.lg, paddingVertical: 14, marginTop: Spacing.sm },
  confirmBtnTxt: { color: Colors.background, fontSize: 15, fontWeight: '700' },

  successBox:    { alignItems: 'center', paddingVertical: Spacing.lg, gap: 10 },
  successTitle:  { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  successSub:    { fontSize: 13, color: Colors.muted, textAlign: 'center', paddingHorizontal: Spacing.md },

  errorBox:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EF444420', borderRadius: Radius.md, padding: Spacing.sm, marginTop: Spacing.xs },
  errorTxt:      { flex: 1, fontSize: 13, color: '#EF4444' },
});
