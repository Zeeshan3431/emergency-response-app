/**
 * HomeScreen.tsx — Final stable version
 *
 * Key fix: On mount, calls NativeModules.EmergencyModule.getPendingImpact()
 * to check if app was opened from a background impact notification.
 * This is safe because it happens AFTER JS is fully loaded.
 * No more crashes from premature native-to-JS bridge calls.
 */

import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  StatusBar,
  Alert,
  PermissionsAndroid,
  NativeModules,
  Linking,
  TextInput,
  Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEmergencyFlow, EmergencyFlowBridge } from '../hooks/useEmergencyFlow';
import { useEmergency } from '../context/EmergencyContext';
import { impactDetectionService } from '../services/ImpactDetectionService';
import { colors } from '../theme/colors';
import VoiceMicButton from '../components/VoiceMicButton';
import { contactsService, EmergencyContact } from '../services/ContactsService';
import { consentService } from '../services/ConsentService';
import { USER_INFO_KEY, UserInfo } from './OnboardingScreen';

let setupDone = false;

const SCENARIOS = [
  { label: '🚨 Assault / Violence', message: 'I am being assaulted. Send help immediately.' },
  { label: '🏥 Medical Emergency', message: 'Medical emergency. I need an ambulance.' },
  { label: '🚗 Kidnapping', message: 'I am being kidnapped. Track this device.' },
  { label: '🔥 Fire / Hazard', message: 'Fire or hazardous situation. Evacuate needed.' },
];

const HomeScreen: React.FC = () => {
  const { triggerManual, setScenario, emergencyState } = useEmergencyFlow();
  const { markImpact } = useEmergency();
  const [customScenario, setCustomScenario] = React.useState(emergencyState.scenarioMessage);
  const [contacts, setContacts] = React.useState<EmergencyContact[]>([]);
  const [newContactName, setNewContactName] = React.useState('');
  const [newContactPhone, setNewContactPhone] = React.useState('');
  const [evidenceConsentEnabled, setEvidenceConsentEnabled] = React.useState(false);
  const [userInfo, setUserInfo] = React.useState<UserInfo | null>(null);

  // Load saved user info (name, phone, address) for emergency SMS
  useEffect(() => {
    const loadUserInfo = async () => {
      try {
        const raw = await AsyncStorage.getItem(USER_INFO_KEY);
        if (raw) setUserInfo(JSON.parse(raw));
      } catch { /* ignore */ }
    };
    loadUserInfo();
  }, []);

  // ── 1. Check if opened from background impact notification ─────────────────
  useEffect(() => {
    const checkPendingImpact = async () => {
      if (Platform.OS !== 'android') return;
      if (!NativeModules.EmergencyModule) return;

      try {
        const result = await NativeModules.EmergencyModule.getPendingImpact();
        if (result?.impact === true) {
          // Small delay to let navigation settle before triggering flow
          setTimeout(() => {
            markImpact();
          }, 300);
        }
      } catch {
        // getPendingImpact failed — safe to ignore in production
      }
    };

    checkPendingImpact();
  }, [markImpact]);

  useEffect(() => {
    const loadContacts = async () => {
      const saved = await contactsService.getAll();
      setContacts(saved);
    };
    loadContacts();
  }, []);

  useEffect(() => {
    const loadConsent = async () => {
      const consent = await consentService.getEvidenceConsent();
      setEvidenceConsentEnabled(consent.granted);
    };
    loadConsent();
  }, []);

  // ── 2. One-time permissions + battery optimization request ──────────────────
  useEffect(() => {
    if (setupDone) return;
    setupDone = true;

    const setup = async () => {
      if (Platform.OS !== 'android') return;
      try {
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
          PermissionsAndroid.PERMISSIONS.CALL_PHONE,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          PermissionsAndroid.PERMISSIONS.SEND_SMS,
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        ]);

        const locationGranted =
          results[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === 'granted' ||
          results[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] === 'granted';

        if (!locationGranted) {
          Alert.alert(
            'Location Required',
            'Location permission is needed to share your position with emergency responders.',
            [
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
              { text: 'Later', style: 'cancel' },
            ],
          );
          return;
        }

        // Request Doze exemption via system prompt
        setTimeout(async () => {
          try {
            const isIgnored = await NativeModules.EmergencyModule.isIgnoringBatteryOptimizations();
            if (!isIgnored) {
              Alert.alert(
                '🔋 Enable Background Protection',
                'Your phone will kill the emergency sensor if battery optimizations are active.\n\nPlease tap "Allow" on the next screen to keep yourself protected continuously.',
                [
                  { 
                    text: 'Continue', 
                    onPress: () => NativeModules.EmergencyModule.requestIgnoreBatteryOptimizations() 
                  },
                ],
              );
            }
          } catch {
            // Battery optimization check failed — non-critical
          }
        }, 1500);

      } catch {
        // Setup error — non-critical
      }
    };

    setup();
  }, []);

  // ── 3. Start foreground service + JS sensor ─────────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'android' && NativeModules.EmergencyModule) {
      NativeModules.EmergencyModule.startForegroundService()
        .catch((_err: any) => { /* Foreground service error — non-critical */ });
    }

    EmergencyFlowBridge.register(() => {
      markImpact();
    });

    if (!impactDetectionService.running) {
      impactDetectionService.start(magnitude => {
        EmergencyFlowBridge.onImpact(magnitude);
      });
    }

    return () => {
      EmergencyFlowBridge.register(() => {});
    };
  }, [markImpact]);

  const handleScenarioSelect = (message: string, label: string) => {
    setScenario(message);
    setCustomScenario(message);
    Alert.alert('Scenario Set', `"${label}" selected.`, [{ text: 'OK' }]);
  };

  const handleCustomScenarioCommit = () => {
    const message = customScenario.trim();
    if (!message) return;
    setScenario(message);
  };

  const handleVoiceResult = (spokenText: string) => {
    const next = spokenText.trim();
    if (!next) return;
    setCustomScenario(next);
    setScenario(next);
  };

  const handleAddContact = async () => {
    const name = newContactName.trim();
    const phone = newContactPhone.trim();
    if (!name || !phone) {
      Alert.alert('Missing details', 'Please add both contact name and phone number.');
      return;
    }
    try {
      await contactsService.add(name, phone);
      setContacts(await contactsService.getAll());
      setNewContactName('');
      setNewContactPhone('');
    } catch {
      Alert.alert('Invalid phone number', 'Please enter a valid contact number (digits only).');
    }
  };

  const handleDeleteContact = async (id: string) => {
    await contactsService.remove(id);
    setContacts(await contactsService.getAll());
  };

  const sanitizePhoneInput = (value: string): string => {
    // Allow only digits and a leading +
    const cleaned = value.replace(/[^\d+]/g, '');
    if (!cleaned.includes('+')) return cleaned;
    const digitsOnly = cleaned.replace(/\+/g, '');
    return cleaned.startsWith('+') ? `+${digitsOnly}` : digitsOnly;
  };

  const handleEvidenceConsentToggle = async (enabled: boolean) => {
    setEvidenceConsentEnabled(enabled);
    await consentService.setEvidenceConsent(enabled);
  };

  const sensorActive = impactDetectionService.running;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      <View style={styles.header}>
        <Text style={styles.title}>Emergency Response</Text>
        <View style={[styles.badge, sensorActive ? styles.badgeOn : styles.badgeOff]}>
          <Text style={styles.badgeText}>
            {sensorActive ? '🟢 Sensor Active' : '🔴 Sensor Off'}
          </Text>
        </View>
      </View>

      {Platform.OS === 'android' && sensorActive && (
        <View style={styles.successNotice}>
          <Text style={styles.noticeText}>
            🛡️ Protected while app is open or minimized.{'\n'}
            For lock screen protection: set battery to Unrestricted.
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={styles.emergencyButton}
        onPress={triggerManual}
        activeOpacity={0.8}
        accessibilityLabel="Trigger emergency"
        accessibilityRole="button">
        <Text style={styles.emergencyIcon}>🚨</Text>
        <Text style={styles.emergencyLabel}>EMERGENCY</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Select Scenario (Optional)</Text>
      <Text style={styles.sectionSubtitle}>
        Pre-select your situation so responders receive the right message.
      </Text>

      {SCENARIOS.map(s => (
        <TouchableOpacity
          key={s.message}
          style={[
            styles.scenarioCard,
            emergencyState.scenarioMessage === s.message && styles.scenarioCardSelected,
          ]}
          onPress={() => handleScenarioSelect(s.message, s.label)}
          accessibilityRole="button">
          <Text style={styles.scenarioLabel}>{s.label}</Text>
          {emergencyState.scenarioMessage === s.message && (
            <Text style={styles.scenarioCheck}>✓</Text>
          )}
        </TouchableOpacity>
      ))}

      <View style={styles.customBox}>
        <Text style={styles.sectionTitle}>Custom Message (Voice or Typing)</Text>
        <Text style={styles.sectionSubtitle}>
          Use any language (English, Urdu, Hindi, etc.). Speech is transcribed to text.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Describe your emergency for responders..."
          placeholderTextColor="#999"
          value={customScenario}
          onChangeText={setCustomScenario}
          onBlur={handleCustomScenarioCommit}
          multiline
        />
        <VoiceMicButton onResult={handleVoiceResult} />
      </View>

      <View style={styles.contactsBox}>
        <Text style={styles.sectionTitle}>Emergency Contacts (SMS Alert List)</Text>
        <TextInput
          style={styles.input}
          placeholder="Contact name"
          placeholderTextColor="#999"
          value={newContactName}
          onChangeText={setNewContactName}
        />
        <TextInput
          style={styles.input}
          placeholder="Phone number (e.g. +1...)"
          placeholderTextColor="#999"
          value={newContactPhone}
          onChangeText={text => setNewContactPhone(sanitizePhoneInput(text))}
          keyboardType="phone-pad"
        />
        <TouchableOpacity style={styles.addContactButton} onPress={handleAddContact}>
          <Text style={styles.addContactButtonText}>Add Emergency Contact</Text>
        </TouchableOpacity>

        {contacts.map(contact => (
          <View key={contact.id} style={styles.contactRow}>
            <View>
              <Text style={styles.contactName}>{contact.name}</Text>
              <Text style={styles.contactPhone}>{contact.phone}</Text>
            </View>
            <TouchableOpacity onPress={() => handleDeleteContact(contact.id)}>
              <Text style={styles.deleteText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <View style={styles.consentBox}>
        <Text style={styles.sectionTitle}>Evidence Consent</Text>
        <Text style={styles.sectionSubtitle}>
          I consent to emergency audio evidence capture/upload when an emergency is active.
        </Text>
        <View style={styles.consentRow}>
          <Text style={styles.consentText}>
            {evidenceConsentEnabled ? 'Consent granted' : 'Consent not granted'}
          </Text>
          <Switch
            value={evidenceConsentEnabled}
            onValueChange={handleEvidenceConsentToggle}
            trackColor={{ false: '#bbb', true: '#4CAF50' }}
            thumbColor="#fff"
          />
        </View>
      </View>

      <Text style={styles.footer}>
        Impact threshold: 2.5g · Confirmation: 10 seconds{'\n'}
        Native Kotlin sensor · Background protection active
      </Text>
    </ScrollView>
  );
};

export default HomeScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48 },
  header: { marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: 8 },
  badge: { alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  badgeOn: { backgroundColor: '#E6F4EA' },
  badgeOff: { backgroundColor: '#FDECEA' },
  badgeText: { fontSize: 13, fontWeight: '600' },
  warningNotice: {
    backgroundColor: '#FFF8E1', borderRadius: 10, padding: 14,
    marginBottom: 16, borderLeftWidth: 4, borderLeftColor: '#FFC107',
  },
  successNotice: {
    backgroundColor: '#E8F5E9', borderRadius: 10, padding: 14,
    marginBottom: 16, borderLeftWidth: 4, borderLeftColor: '#4CAF50',
  },
  noticeText: { fontSize: 13, color: '#333', lineHeight: 19 },
  emergencyButton: {
    backgroundColor: colors.danger, borderRadius: 120,
    width: 200, height: 200, alignSelf: 'center',
    justifyContent: 'center', alignItems: 'center', marginVertical: 28,
    shadowColor: '#D32F2F', shadowOpacity: 0.5, shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  emergencyIcon: { fontSize: 60 },
  emergencyLabel: { color: '#fff', fontWeight: '800', fontSize: 18, letterSpacing: 2, marginTop: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: 14 },
  scenarioCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 2, borderColor: 'transparent',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  scenarioCardSelected: { borderColor: colors.danger, backgroundColor: '#FFF5F5' },
  scenarioLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  scenarioCheck: { fontSize: 18, color: colors.danger },
  footer: { marginTop: 32, fontSize: 11, color: '#999', textAlign: 'center', lineHeight: 18 },
  customBox: { marginTop: 20 },
  contactsBox: { marginTop: 20 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#222',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  addContactButton: {
    backgroundColor: '#1565C0',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  addContactButtonText: { color: '#fff', fontWeight: '700' },
  contactRow: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#eee',
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  contactName: { fontSize: 14, fontWeight: '700', color: '#111' },
  contactPhone: { fontSize: 13, color: '#555' },
  deleteText: { color: '#D32F2F', fontWeight: '700' },
  consentBox: {
    marginTop: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
    padding: 14,
  },
  consentRow: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  consentText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#222',
  },
});