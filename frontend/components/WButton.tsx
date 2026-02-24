import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { Colors, Radius, Spacing } from '../constants/Colors';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export function WButton({ label, onPress, variant = 'primary', size = 'md', loading, disabled, style, testID }: Props) {
  const isDisabled = disabled || loading;
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.75}
      style={[styles.base, styles[variant], styles[size], isDisabled && styles.disabled, style]}
    >
      {loading
        ? <ActivityIndicator color={variant === 'primary' ? '#fff' : Colors.primary} size="small" />
        : <Text style={[styles.label, styles[`${variant}Label` as keyof typeof styles]]}>{label}</Text>
      }
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  primary: { backgroundColor: Colors.primary },
  secondary: { backgroundColor: Colors.secondary, borderWidth: 1.5, borderColor: Colors.border },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: Colors.destructive },
  sm: { paddingVertical: Spacing.xs + 2, paddingHorizontal: Spacing.md },
  md: { paddingVertical: Spacing.sm + 4, paddingHorizontal: Spacing.lg },
  lg: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl },
  disabled: { opacity: 0.5 },
  label: { fontWeight: '600', letterSpacing: 0.3 },
  primaryLabel: { color: '#fff', fontSize: 15 },
  secondaryLabel: { color: Colors.foreground, fontSize: 15 },
  ghostLabel: { color: Colors.primary, fontSize: 15 },
  dangerLabel: { color: '#fff', fontSize: 15 },
});
