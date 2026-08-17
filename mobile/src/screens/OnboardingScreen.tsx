/**
 * OnboardingScreen.tsx
 *
 * First-launch registration form for BOTH Android and iOS.
 * Collects: Full Name, Address, Phone Number.
 * Saved to AsyncStorage — used in emergency SMS messages.
 * After saving → navigates directly to Home (no iOS disclosure screen).
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;

interface Props {
  navigation: NavigationProp;
}

export const USER_INFO_KEY = '@ers_user_info';

export interface UserInfo {
  name: string;
  phone: string;
  address: string;
}

const OnboardingScreen: React.FC<Props> = ({ navigation }) => {
  const [name, setName]       = useState('');
  const [phone, setPhone]     = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkExisting = async () => {
      try {
        const stored = await AsyncStorage.getItem(USER_INFO_KEY);
        if (stored) {
          // Already onboarded — go straight to Home on both platforms
          navigation.replace('Home');
        } else {
          setLoading(false);
        }
      } catch {
        setLoading(false);
      }
    };
    checkExisting();
  }, [navigation]);

  const sanitizePhone = (value: string): string => {
    const cleaned = value.replace(/[^\d+]/g, '');
    if (!cleaned.includes('+')) return cleaned;
    const digitsOnly = cleaned.replace(/\+/g, '');
    return cleaned.startsWith('+') ? `+${digitsOnly}` : digitsOnly;
  };

  const handleSave = async () => {
    const trimmedName    = name.trim();
    const trimmedPhone   = phone.trim();
    const trimmedAddress = address.trim();

    if (!trimmedName || !trimmedPhone) {
      Alert.alert(
        'Required Fields',
        'Please enter your full name and phone number to continue.',
      );
      return;
    }

    try {
      const userInfo: UserInfo = {
        name:    trimmedName,
        phone:   trimmedPhone,
        address: trimmedAddress,
      };
      await AsyncStorage.setItem(USER_INFO_KEY, JSON.stringify(userInfo));
      // Go straight to Home — no iOS limitations screen needed in production
      navigation.replace('Home');
    } catch {
      Alert.alert('Error', 'Failed to save your details. Please try again.');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.badge}>🚨 Emergency Response</Text>
          <Text style={styles.title}>Welcome</Text>
          <Text style={styles.subtitle}>
            Enter your details below. This information is sent to your emergency
            contacts automatically when you trigger an alert — so help reaches
            you faster.
          </Text>
        </View>

        {/* Full Name */}
        <View style={styles.field}>
          <Text style={styles.label}>Full Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Ali Hassan"
            placeholderTextColor="#aaa"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            returnKeyType="next"
          />
        </View>

        {/* Phone Number */}
        <View style={styles.field}>
          <Text style={styles.label}>Your Phone Number *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. +92 300 1234567"
            placeholderTextColor="#aaa"
            value={phone}
            onChangeText={text => setPhone(sanitizePhone(text))}
            keyboardType="phone-pad"
            returnKeyType="next"
          />
          <Text style={styles.hint}>
            This number will appear in emergency SMS messages to your contacts.
          </Text>
        </View>

        {/* Address / Location */}
        <View style={styles.field}>
          <Text style={styles.label}>Home Address / Location</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            placeholder="e.g. House 12, Street 4, F-7/1, Islamabad"
            placeholderTextColor="#aaa"
            value={address}
            onChangeText={setAddress}
            multiline
            numberOfLines={2}
            returnKeyType="done"
          />
          <Text style={styles.hint}>
            Optional — helps responders locate you if GPS is unavailable.
          </Text>
        </View>

        {/* Info box */}
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>📲 How it's used</Text>
          <Text style={styles.infoText}>
            When you press the Emergency button, your emergency contacts will
            receive an SMS like:{'\n\n'}
            <Text style={styles.infoExample}>
              "🚨 EMERGENCY ALERT: Ali Hassan needs help! Phone: +92 300 1234567.
              Location: [GPS coordinates / Home address]. Tap to respond."
            </Text>
          </Text>
        </View>

        {/* Submit */}
        <TouchableOpacity style={styles.button} onPress={handleSave} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Continue →</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>
          Your details are stored only on this device and never shared without your consent.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default OnboardingScreen;

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  loadingText: { fontSize: 15, color: '#888' },

  content: { padding: 24, paddingBottom: 56 },

  header: { marginBottom: 32 },
  badge: {
    fontSize: 13, fontWeight: '700', color: '#D32F2F',
    backgroundColor: '#FFF0F0', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, alignSelf: 'flex-start', marginBottom: 16,
    overflow: 'hidden',
  },
  title: { fontSize: 34, fontWeight: '800', color: '#111', marginBottom: 10 },
  subtitle: { fontSize: 15, color: '#555', lineHeight: 23 },

  field: { marginBottom: 22 },
  label: { fontSize: 14, fontWeight: '700', color: '#333', marginBottom: 8 },
  input: {
    backgroundColor: '#F7F7F7',
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111',
  },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  hint: { fontSize: 12, color: '#888', marginTop: 5, lineHeight: 17 },

  infoBox: {
    backgroundColor: '#F0F7FF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 28,
    borderLeftWidth: 4,
    borderLeftColor: '#1565C0',
  },
  infoTitle: { fontSize: 14, fontWeight: '700', color: '#0D47A1', marginBottom: 8 },
  infoText: { fontSize: 13, color: '#1a3a6b', lineHeight: 20 },
  infoExample: { fontStyle: 'italic', color: '#0D47A1' },

  button: {
    backgroundColor: '#D32F2F',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: '#D32F2F',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    marginBottom: 20,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },

  footer: { fontSize: 12, color: '#aaa', textAlign: 'center', lineHeight: 18 },
});
