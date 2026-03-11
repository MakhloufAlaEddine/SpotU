/**
 * components/EmptyState.tsx
 * Écran vide partagé : icône + titre + sous-titre optionnel + bouton d'action optionnel.
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Spacing } from '../constants/Colors';

export interface EmptyStateProps {
  /** Nom Ionicons (ex: "chatbubbles-outline") */
  icon: any;
  iconColor?: string;
  iconSize?: number;
  title: string;
  subtitle?: string;
  action?: {
    label: string;
    onPress: () => void;
    testID?: string;
  };
  testID?: string;
  style?: ViewStyle;
}

export function EmptyState({
  icon,
  iconColor = Colors.muted,
  iconSize = 48,
  title,
  subtitle,
  action,
  testID,
  style,
}: EmptyStateProps) {
  return (
    <View style={[es.wrap, style]} testID={testID}>
      <View style={es.iconWrap}>
        <Ionicons name={icon} size={iconSize} color={iconColor} />
      </View>
      <Text style={es.title}>{title}</Text>
      {subtitle ? <Text style={es.subtitle}>{subtitle}</Text> : null}
      {action ? (
        <TouchableOpacity
          style={es.btn}
          onPress={action.onPress}
          testID={action.testID}
          activeOpacity={0.85}
        >
          <Text style={es.btnText}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const es = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foreground,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  btn: {
    marginTop: 8,
    backgroundColor: Colors.primary,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 11,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.background,
  },
});
