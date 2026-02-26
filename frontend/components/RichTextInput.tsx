import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, NativeSyntheticEvent,
  TextInputSelectionChangeEventData,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/Colors';

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
  testID?: string;
}

type Format = 'bold' | 'italic' | 'bullet' | 'underline';

const WRAPPERS: Record<Format, [string, string]> = {
  bold:      ['**', '**'],
  italic:    ['_', '_'],
  underline: ['__', '__'],
  bullet:    ['• ', ''],
};

const TOOLBAR = [
  { fmt: 'bold' as Format,      icon: 'text' as const,         label: 'G' },
  { fmt: 'italic' as Format,    icon: 'italic' as const,       label: 'I' },
  { fmt: 'underline' as Format, icon: 'underline' as const,    label: 'S' },
  { fmt: 'bullet' as Format,    icon: 'list-outline' as const, label: '•' },
];

export function RichTextInput({ value, onChangeText, placeholder, maxLength, testID }: Props) {
  const inputRef = useRef<TextInput>(null);
  const selRef = useRef({ start: 0, end: 0 });
  const [activeFormats, setActiveFormats] = useState<Set<Format>>(new Set());

  const handleSelectionChange = (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    selRef.current = e.nativeEvent.selection;
  };

  const applyFormat = (fmt: Format) => {
    const { start, end } = selRef.current;
    const [before, after] = WRAPPERS[fmt];

    if (fmt === 'bullet') {
      // Add bullet at start of line
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const newValue = value.slice(0, lineStart) + '• ' + value.slice(lineStart);
      onChangeText(newValue);
      return;
    }

    if (start === end) {
      // No selection: insert syntax at cursor
      const newValue = value.slice(0, start) + before + after + value.slice(start);
      onChangeText(newValue);
    } else {
      // Wrap selected text
      const selected = value.slice(start, end);
      // Toggle: if already wrapped, unwrap
      if (selected.startsWith(before) && selected.endsWith(after)) {
        onChangeText(value.slice(0, start) + selected.slice(before.length, selected.length - after.length) + value.slice(end));
      } else {
        onChangeText(value.slice(0, start) + before + selected + after + value.slice(end));
      }
    }
    inputRef.current?.focus();
  };

  return (
    <View style={st.container}>
      {/* Toolbar */}
      <View style={st.toolbar}>
        {TOOLBAR.map(({ fmt, label, icon }) => (
          <TouchableOpacity
            key={fmt}
            style={[st.toolBtn]}
            onPress={() => applyFormat(fmt)}
            testID={`fmt-${fmt}`}
          >
            <Text style={[
              st.toolLabel,
              fmt === 'bold' && { fontWeight: '900' },
              fmt === 'italic' && { fontStyle: 'italic' },
              fmt === 'underline' && { textDecorationLine: 'underline' },
            ]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={st.toolSep} />
        <Text style={st.toolHint}>Sélectionnez du texte et appuyez sur un bouton</Text>
      </View>

      {/* Input */}
      <TextInput
        ref={inputRef}
        style={st.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.muted}
        multiline
        numberOfLines={5}
        textAlignVertical="top"
        maxLength={maxLength}
        onSelectionChange={handleSelectionChange}
        testID={testID}
      />
    </View>
  );
}

// ─── Markdown renderer (for display) ─────────────────────────────────────────
interface MarkdownProps { text: string; style?: object }

export function MarkdownText({ text, style }: MarkdownProps) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <View>
      {lines.map((line, i) => {
        const isBullet = line.startsWith('• ');
        const content = isBullet ? line.slice(2) : line;
        return (
          <View key={i} style={isBullet ? mk.bulletRow : undefined}>
            {isBullet && <Text style={mk.bulletDot}>•</Text>}
            <Text style={[mk.base, style as any, isBullet && { flex: 1 }]}>
              {parseInline(content)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function parseInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Match **bold**, __underline__, _italic_
  const regex = /(\*\*[^*]+\*\*|__[^_]+__|_[^_]+_)/g;
  let last = 0;
  let match;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(<Text key={key++}>{text.slice(last, match.index)}</Text>);
    const raw = match[0];
    if (raw.startsWith('**')) {
      parts.push(<Text key={key++} style={{ fontWeight: '700' }}>{raw.slice(2, -2)}</Text>);
    } else if (raw.startsWith('__')) {
      parts.push(<Text key={key++} style={{ textDecorationLine: 'underline' }}>{raw.slice(2, -2)}</Text>);
    } else {
      parts.push(<Text key={key++} style={{ fontStyle: 'italic' }}>{raw.slice(1, -1)}</Text>);
    }
    last = match.index + raw.length;
  }
  if (last < text.length) parts.push(<Text key={key++}>{text.slice(last)}</Text>);
  return parts;
}

const st = StyleSheet.create({
  container: { backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 2 },
  toolBtn: { width: 34, height: 34, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  toolLabel: { fontSize: 15, color: Colors.foreground, fontWeight: '500' },
  toolSep: { width: 1, height: 22, backgroundColor: Colors.border, marginHorizontal: 6 },
  toolHint: { fontSize: 10, color: Colors.muted, flex: 1 },
  input: { padding: Spacing.md, fontSize: 15, color: Colors.foreground, minHeight: 110, textAlignVertical: 'top' },
});

const mk = StyleSheet.create({
  base: { fontSize: 15, lineHeight: 22, color: Colors.foreground },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginVertical: 2 },
  bulletDot: { fontSize: 15, color: Colors.primary, lineHeight: 22, marginTop: 1 },
});
