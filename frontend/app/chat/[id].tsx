import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { useChat, ChatMessage } from '../../lib/chat';
import { api } from '../../lib/api';

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

function Bubble({ msg, isMe }: { msg: ChatMessage; isMe: boolean }) {
  return (
    <View style={[st.bubbleRow, isMe && st.bubbleRowMe]}>
      {!isMe && (
        msg.sender_picture ? (
          <Image source={{ uri: msg.sender_picture }} style={st.bubbleAvatar} />
        ) : (
          <View style={[st.bubbleAvatar, { backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.primary }}>
              {(msg.sender_name || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
        )
      )}
      <View style={[st.bubble, isMe ? st.bubbleMe : st.bubbleThem]}>
        {!isMe && (
          <Text style={st.bubbleSender}>{msg.sender_name}</Text>
        )}
        <Text style={[st.bubbleText, isMe && st.bubbleTextMe]}>{msg.content}</Text>
        <Text style={[st.bubbleTime, isMe && st.bubbleTimeMe]}>{formatTime(msg.created_at)}</Text>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [input, setInput] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [convInfo, setConvInfo] = useState<any>(null);
  const [sending, setSending] = useState(false);
  const flatRef = useRef<FlatList>(null);

  const { messages, sendMessage, isConnected } = useChat(id ?? null);

  useEffect(() => {
    api.get<any>('/auth/me').then(me => setCurrentUserId(me.user_id)).catch(() => {});
    if (id) {
      api.get<any[]>('/conversations').then(convs => {
        const c = convs?.find(cv => cv.conversation_id === id);
        if (c) setConvInfo(c);
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
    setSending(true);
    sendMessage(text);
    setInput('');
    setSending(false);
  }, [input, sending, sendMessage]);

  const typeLabel = convInfo?.type === 'service' ? 'Service'
    : convInfo?.type === 'tagpoint_group' ? 'Groupe'
    : 'Message privé';

  const headerTitle = convInfo?.other_participant?.name ?? convInfo?.context_title ?? '…';
  const headerSub = convInfo ? `${typeLabel} · ${convInfo.context_title}` : '';

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

      {/* Messages */}
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={m => m.message_id}
        contentContainerStyle={st.messageList}
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
            <Bubble msg={item} isMe={item.sender_id === currentUserId} />
          </>
        )}
        ListEmptyComponent={
          <View style={st.emptyChat}>
            <Ionicons name="chatbubble-outline" size={40} color={Colors.muted} />
            <Text style={st.emptyChatText}>Aucun message pour l'instant</Text>
            <Text style={st.emptyChatSub}>Envoie le premier message !</Text>
          </View>
        }
      />

      {/* Input bar */}
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
});
