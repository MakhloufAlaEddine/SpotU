import React, { useState } from 'react';
import { View, TextInput, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { Colors, Radius, Spacing } from '../constants/Colors';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
  numberOfLines?: number;
  style?: ViewStyle;
  testID?: string;
}

export function WInput({ label, placeholder, value, onChangeText, secureTextEntry, keyboardType, autoCapitalize, multiline, numberOfLines, style, testID }: Props) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(secureTextEntry ?? false);

  return (
    <View style={[styles.container, style]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.inputWrap, focused && styles.focused]}>
        <TextInput
          testID={testID}
          style={[styles.input, multiline && styles.multiline]}
          placeholder={placeholder}
          placeholderTextColor={Colors.muted}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={hidden}
          keyboardType={keyboardType ?? 'default'}
          autoCapitalize={autoCapitalize ?? 'sentences'}
          multiline={multiline}
          numberOfLines={numberOfLines}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {secureTextEntry && (
          <TouchableOpacity onPress={() => setHidden(!hidden)} style={styles.eye}>
            <Ionicons 
              name={hidden ? 'eye-outline' : 'eye-off-outline'} 
              size={20} 
              color={Colors.muted} 
            />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: Spacing.md },
  label: { 
    fontSize: 13, 
    fontWeight: '600', 
    color: Colors.foreground, 
    marginBottom: 6 
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: 'transparent',
  },
  focused: { borderBottomColor: Colors.primary },
  input: { 
    flex: 1, 
    paddingVertical: Spacing.sm + 2, 
    fontSize: 15, 
    color: Colors.foreground 
  },
  multiline: { paddingTop: Spacing.sm + 2, minHeight: 80, textAlignVertical: 'top' },
  eye: { padding: 4 },
});
