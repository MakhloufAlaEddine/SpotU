/**
 * components/ScreenLoader.tsx
 * Spinner centré plein-écran, utilisé pendant `loading_initial`.
 */
import React from 'react';
import { View, ActivityIndicator, ViewStyle } from 'react-native';
import { Colors } from '../constants/Colors';

export interface ScreenLoaderProps {
  color?: string;
  size?: 'small' | 'large';
  style?: ViewStyle;
}

export function ScreenLoader({
  color = Colors.primary,
  size = 'large',
  style,
}: ScreenLoaderProps) {
  return (
    <View
      style={[{ flex: 1, alignItems: 'center', justifyContent: 'center' }, style]}
      testID="screen-loader"
    >
      <ActivityIndicator size={size} color={color} />
    </View>
  );
}
