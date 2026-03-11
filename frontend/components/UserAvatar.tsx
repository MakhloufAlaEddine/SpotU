/**
 * components/UserAvatar.tsx
 * Avatar circulaire partagé : photo ou initiale en fallback.
 */
import React from 'react';
import { View, Image, Text, ViewStyle } from 'react-native';
import { Colors } from '../constants/Colors';

export interface UserAvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: number;
  /** Couleur de la lettre initiale (défaut: Colors.primary) */
  color?: string;
  /** Fond de la zone initiale (défaut: Colors.primary + '20') */
  bgColor?: string;
  /** Bordure optionnelle */
  borderColor?: string;
  borderWidth?: number;
  style?: ViewStyle;
  testID?: string;
}

export function UserAvatar({
  uri,
  name,
  size = 40,
  color = Colors.primary,
  bgColor,
  borderColor,
  borderWidth: bw = 2,
  style,
  testID,
}: UserAvatarProps) {
  const r = size / 2;
  const bg = bgColor ?? Colors.primary + '20';
  const containerStyle: ViewStyle = {
    width: size,
    height: size,
    borderRadius: r,
    overflow: 'hidden',
    backgroundColor: bg,
    alignItems: 'center',
    justifyContent: 'center',
    ...(borderColor ? { borderColor, borderWidth: bw } : {}),
  };
  const fs = Math.round(size * 0.4);

  return (
    <View style={[containerStyle, style]} testID={testID}>
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          resizeMode="cover"
        />
      ) : (
        <Text style={{ fontSize: fs, fontWeight: '700', color }}>
          {(name ?? '?').charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}
