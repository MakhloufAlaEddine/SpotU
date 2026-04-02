import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Image,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { useChat, ChatMessage } from '../../lib/chat';
import { api } from '../../lib/api';
import { storage } from '../../lib/storage';
import { ErrorNoData } from '../../components/OfflineBanner';
import { useGuardedRouter } from '../../hooks/useGuardedRouter';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yesterday.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function shouldShowDaySeparator(messages: ChatMessage[], index: number): boolean {
  if (index === 0) return true;
  const prev = new Date(messages[index - 1].created_at).toDateString();
  const curr = new Date(messages[index].created_at).toDateString();
  return prev !== curr;
}

/** Résout un titre brut en titre lisible — même logique que dans chat.tsx */
function resolveDisplayTitle(raw: string | null | undefined): string {
  if (!raw) return 'Sans titre';
  if (/^(pt|conv|svc|user)_/.test(raw)) return 'SpotYou supprimé';
  return raw;
}


function MessageBubble({ msg, isMe }: { msg: ChatMessage; isMe: boolean }) {
  // Détection message soft-deleted (deleted_at non-null OU contenu marqué par le backend)
  const isDeleted = !!msg.deleted_at || msg.content === '[Message supprimé]';
  const senderLabel = msg.sender_name || 'Utilisateur supprimé';

  return (
    <View style={[st.bubbleRow, isMe && st.bubbleRowMe]}>
      {!isMe && (
        msg.sender_picture ? (
          <Image source={{ uri: msg.sender_picture }} style={st.bubbleAvatar} />
        ) : (
          <View style={[st.bubbleAvatar, { backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.primary }}>
              {senderLabel.charAt(0).toUpperCase()}
            </Text>
          </View>
        )
      )}
      <View style={[st.bubble, isMe ? st.bubbleMe : st.bubbleThem, isDeleted && st.bubbleDeletedWrap]}>
        {!isMe && (
          <Text style={[st.bubbleSender, isDeleted && { color: Colors.muted }]}>{senderLabel}</Text>
        )}
        <Text style={[st.bubbleText, isMe && !isDeleted && st.bubbleTextMe, isDeleted && st.bubbleDeletedText]}>
          {isDeleted ? '[Message supprimé]' : msg.content}
        </Text>
        {!isDeleted && (
          <Text style={[st.bubbleTime, isMe && st.bubbleTimeMe]}>{formatTime(msg.created_at)}</Text>
        )}
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useGuardedRouter();
  const [input, setInput] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [convInfo, setConvInfo] = useState<any>(null);
  const [sending, setSending] = useState(false);
  const flatRef = useRef<FlatList>(null);

  const { messages, sendMessage, isConnected, historyState, loadHistory } = useChat(id ?? null);

  const isBlocked = convInfo?.is_blocked === true;
  const isContextDeleted = convInfo?.context_deleted === true;

  useEffect(() => {
    // currentUserId depuis le cache auth (offline-safe, évite l'appel /auth/me)
    storage.get('spotu_user').then(raw => {
      if (raw) {
        try { setCurrentUserId(JSON.parse(raw).user_id); } catch {}
      }
    }).catch(() => {});

    if (id) {
      // Lecture du cache convInfo en premier (offline-safe)
      storage.get(`spotu_conv_${id}`).then(raw => {
        if (raw) { try { setConvInfo(JSON.parse(raw)); } catch {} }
      }).catch(() => {});

      // Puis fetch réseau avec mise en cache
      api.get<any[]>('/conversations').then(convs => {
        const c = convs?.find(cv => cv.conversation_id === id);
        if (c) {
          setConvInfo(c);
          storage.set(`spotu_conv_${id}`, JSON.stringify(c)).catch(() => {});
        }
      }).catch(() => {});
    }
  }, [id]);

  // Scroll to bottom on new messages + mark as read (conversation active)
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
      // Marquer comme lu en temps réel quand on est dans la conversation
      if (id) {
        api.put(`/conversations/${id}/read`).catch(() => {});
      }
    }
  }, [messages.length]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || sending) return;
    // Guard : lecture seule si contexte supprimé ou bloqué
    if (isContextDeleted || isBlocked) return;
    if (!isConnected) {
      Alert.alert(
        'Envoi impossible',
        'La connexion au chat est interrompue. Votre message n\'a pas été envoyé.\nVérifiez votre connexion et réessayez.',
      );
      return;
    }
    setSending(true);
    sendMessage(text);
    setInput('');
    setSending(false);
  }, [input, sending, sendMessage, isConnected, isContextDeleted, isBlocked]);

  const typeLabel = convInfo?.type === 'service' ? 'Service'
    : convInfo?.type === 'tagpoint_group' ? 'Groupe'
    : 'Message privé';

  const headerTitle = convInfo?.other_participant?.name
    ?? resolveDisplayTitle(convInfo?.context_title)
    ?? '…';
  const headerSub = convInfo
    ? `${typeLabel} · ${resolveDisplayTitle(convInfo.context_title)}`
    : '';

  return (
    <KeyboardAvoidingView
      style={st.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'android' ? 0 : 0}
    >
      {/* Header */}
      <SafeAreaView edges={['top']} style={st.safeHeader}>
        <View style={st.header}>
          <TouchableOpacity style={st.backBtn} onPress={() => router.back()} testID="chat-back-btn">
            <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
          </TouchableOpacity>

          <View style={st.headerInfo}>
            {convInfo?.type === 'tagpoint_group' ? (
              <View style={[st.groupAvatar]}>
                <Ionicons name="people" size={18} color={Colors.primary} />
              </View>
            ) : convInfo?.other_participant?.picture ? (
              <Image source={{ uri: convInfo.other_participant.picture }} style={st.headerAvatar} />
            ) : (
              <View style={[st.headerAvatar, { backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.primary }}>
                  {headerTitle.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={st.headerTitle} numberOfLines={1}>{headerTitle}</Text>
              {headerSub ? <Text style={st.headerSub} numberOfLines={1}>{headerSub}</Text> : null}
            </View>
          </View>

          <View style={[st.statusDot, { backgroundColor: isConnected ? Colors.success : Colors.muted }]} />
        </View>
      </SafeAreaView>

      {/* Messages ou état d'erreur */}
      {historyState === 'error' && messages.length === 0 ? (
        <View style={{ flex: 1 }}>
          <ErrorNoData
            onRetry={() => loadHistory(true)}
            onBack={() => router.back()}
            testID="chat-error-no-data"
            message="Impossible de charger les messages. Vérifiez votre connexion."
          />
        </View>
      ) : (
      <>
        {/* Bandeau : conversation archivée / contexte supprimé */}
        {isContextDeleted && (
          <View style={st.archivedBanner} testID="chat-archived-banner">
            <Ionicons name="archive-outline" size={15} color={Colors.muted} />
            <Text style={st.archivedBannerText}>
              Cette conversation est archivée. Le contenu lié n'est plus disponible.
              Vous pouvez consulter l'historique, mais vous ne pouvez plus envoyer de messages.
            </Text>
          </View>
        )}
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={m => m.message_id}
          style={{ flex: 1 }}
          contentContainerStyle={[st.messageList, messages.length === 0 && { flex: 1 }]}
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item, index }) => (
            <>
              {shouldShowDaySeparator(messages, index) && (
                <View style={st.daySep}>
                  <View style={st.daySepLine} />
                  <Text style={st.daySepText}>{formatDay(item.created_at)}</Text>
                  <View style={st.daySepLine} />
                </View>
              )}
              <MessageBubble msg={item} isMe={item.sender_id === currentUserId} />
            </>
          )}
          ListEmptyComponent={
            <View style={st.emptyChat}>
              <Ionicons name="chatbubble-outline" size={40} color={Colors.muted} />
              <Text style={st.emptyChatText}>
                {isContextDeleted ? 'Aucun message enregistré' : 'Aucun message pour l\'instant'}
              </Text>
              {!isContextDeleted && (
                <Text style={st.emptyChatSub}>Envoie le premier message !</Text>
              )}
            </View>
          }
        />
      </>
      )}

      {/* Input bar — 3 états : archivé / bloqué / actif */}
      {isContextDeleted ? (
        <SafeAreaView edges={['bottom']} style={st.inputSafe}>
          <View style={st.readOnlyBar} testID="chat-readonly-bar">
            <Ionicons name="lock-closed-outline" size={14} color={Colors.muted} />
            <Text style={st.readOnlyText}>Conversation en lecture seule</Text>
          </View>
        </SafeAreaView>
      ) : isBlocked ? (
        <SafeAreaView edges={['bottom']} style={st.inputSafe}>
          <View style={st.blockedBanner} testID="chat-blocked-banner">
            <Ionicons name="lock-closed-outline" size={16} color={Colors.muted} />
            <Text style={st.blockedText}>
              Chat bloqué — vous n'êtes plus membre du SpotYou «{convInfo?.context_title ?? ''}»
            </Text>
          </View>
        </SafeAreaView>
      ) : (
        <SafeAreaView edges={['bottom']} style={st.inputSafe}>
          <View style={st.inputBar}>
            <TextInput
              style={st.input}
              value={input}
              onChangeText={setInput}
              placeholder="Votre message…"
              placeholderTextColor={Colors.muted}
              multiline
              maxLength={1000}
              onSubmitEditing={handleSend}
              testID="chat-input"
            />
            <TouchableOpacity
              style={[st.sendBtn, (!input.trim() || sending) && st.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!input.trim() || sending}
              testID="chat-send-btn"
            >
              {sending ? (
                <ActivityIndicator size="small" color={Colors.background} />
              ) : (
                <Ionicons name="send" size={18} color={Colors.background} />
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeHeader: { backgroundColor: Colors.header },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.header, gap: 8,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden' },
  groupAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  headerSub: { fontSize: 11, color: Colors.muted, marginTop: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },

  messageList: { padding: Spacing.md, gap: 4, paddingBottom: 8 },

  daySep: {
    flexDirection: 'row', alignItems: 'center',
    marginVertical: Spacing.md, gap: 8,
  },
  daySepLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  daySepText: { fontSize: 11, color: Colors.muted, fontWeight: '600' },

  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginBottom: 4 },
  bubbleRowMe: { flexDirection: 'row-reverse' },
  bubbleAvatar: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden' },
  bubble: {
    maxWidth: '75%', borderRadius: Radius.lg, padding: 10,
    paddingHorizontal: 14,
  },
  bubbleMe: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: Colors.card, borderBottomLeftRadius: 4 },
  bubbleSender: { fontSize: 11, fontWeight: '700', color: Colors.primary, marginBottom: 2 },
  bubbleText: { fontSize: 14, color: Colors.foreground, lineHeight: 20 },
  bubbleTextMe: { color: Colors.background },
  bubbleTime: { fontSize: 10, color: Colors.muted, marginTop: 3, textAlign: 'right' },
  bubbleTimeMe: { color: 'rgba(0,0,0,0.5)' },

  emptyChat: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingTop: 60, gap: 8,
  },
  emptyChatText: { fontSize: 16, fontWeight: '600', color: Colors.foreground },
  emptyChatSub: { fontSize: 13, color: Colors.muted },

  inputSafe: { backgroundColor: Colors.card },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    padding: Spacing.sm, gap: 8,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.card,
  },
  input: {
    flex: 1, minHeight: 40, maxHeight: 120,
    backgroundColor: Colors.background,
    borderRadius: Radius.full, paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 14, color: Colors.foreground,
    borderWidth: 1, borderColor: Colors.border,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  blockedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.card,
  },
  blockedText: {
    flex: 1, fontSize: 13, color: Colors.muted,
    fontStyle: 'italic', lineHeight: 18,
  },

  // ── Archived / context deleted ─────────────────────────────────────────────
  archivedBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  archivedBannerText: {
    flex: 1, fontSize: 12.5, color: Colors.muted,
    lineHeight: 18, fontStyle: 'italic',
  },
  readOnlyBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, paddingVertical: 14, paddingHorizontal: 16,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.card,
  },
  readOnlyText: {
    fontSize: 13, color: Colors.muted, fontStyle: 'italic',
  },

  // ── Message soft-deleted ───────────────────────────────────────────────────
  bubbleDeletedWrap: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderStyle: 'dashed',
  },
  bubbleDeletedText: {
    fontStyle: 'italic', color: Colors.muted, fontSize: 13,
  },
});
