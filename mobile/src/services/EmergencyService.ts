/**
 * EmergencyService — unified ERA API (incidents pipeline on port 3001).
 *
 * NOTE: userId is NOT sent to the backend anymore. The backend derives it
 * from the JWT auth token (req.user.id from authenticateJWT middleware).
 * This prevents FK constraint failures from hardcoded/invalid user_id values.
 */
import { NativeModules, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { API_BASE } from '../config/apiConfig';
import { authService } from './AuthService';
import { callService } from './CallService';
import { contactsService } from './ContactsService';
import { consentService } from './ConsentService';

Geolocation.setRNConfiguration({
  skipPermissionRequests: false,
  authorizationLevel: 'whenInUse',
  enableBackgroundLocationUpdates: false,
  locationProvider: 'auto',
});

export interface SessionPayload {
  scenarioMessage: string;
  location: { lat: number; lng: number } | null;
  platform: 'android' | 'ios';
  impactTimestamp: number;
  evidenceConsent?: {
    granted: boolean;
    grantedAt: number | null;
    version: string;
  };
  emergencyContacts?: Array<{ name: string; phone: string }>;
}

export interface LocationResult {
  lat: number;
  lng: number;
}

/** Map free-text scenario to incident type enum */
function inferIncidentType(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('medical') || lower.includes('heart') || lower.includes('injured')) {
    return 'medical';
  }
  if (lower.includes('kidnap') || lower.includes('abduct')) {
    return 'kidnap';
  }
  if (lower.includes('assault') || lower.includes('attack') || lower.includes('help')) {
    return 'assault';
  }
  return 'other';
}

class EmergencyService {
  private lastContactNotify = { total: 0, sent: 0, failed: 0 };

  private async authHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = await authService.ensureAuthenticated();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  private buildContactAlertMessage(
    scenarioMessage: string,
    location: LocationResult | null,
    timestamp: number,
    userInfo: { name: string; phone: string; address?: string } | null,
  ): string {
    const when = new Date(timestamp).toLocaleString();
    const mapUrl = location
      ? `https://maps.google.com/?q=${location.lat},${location.lng}`
      : null;

    const lines: string[] = [
      `🚨 EMERGENCY ALERT`,
    ];

    if (userInfo?.name) lines.push(`Person: ${userInfo.name}`);
    if (userInfo?.phone) lines.push(`Phone: ${userInfo.phone}`);
    if (userInfo?.address) lines.push(`Address: ${userInfo.address}`);
    lines.push(`Situation: ${scenarioMessage}`);
    lines.push(`Time: ${when}`);

    if (location) {
      lines.push(`GPS: ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`);
      lines.push(`Map: ${mapUrl}`);
    } else if (userInfo?.address) {
      lines.push(`Location (manual): ${userInfo.address}`);
    } else {
      lines.push(`Location: Unavailable`);
    }

    lines.push(`Sent via Emergency Response App.`);
    return lines.join('\n');
  }

  async notifyEmergencyContacts(
    scenarioMessage: string,
    location: LocationResult | null,
    impactTimestamp: number,
  ): Promise<void> {
    const contacts = await contactsService.getAll();
    if (!contacts.length) {
      this.lastContactNotify = { total: 0, sent: 0, failed: 0 };
      return;
    }

    let userInfo: { name: string; phone: string; address?: string } | null = null;
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      const stored = await AsyncStorage.getItem('@ers_user_info');
      if (stored) userInfo = JSON.parse(stored);
    } catch { /* ignore */ }

    const alertMessage = this.buildContactAlertMessage(
      scenarioMessage, location, impactTimestamp, userInfo,
    );

    let sent = 0;
    let failed = 0;

    if (Platform.OS === 'android' && NativeModules.EmergencyModule?.sendEmergencySms) {
      // Android: send silently via native SMS module
      await Promise.all(
        contacts.map(async contact => {
          try {
            await NativeModules.EmergencyModule.sendEmergencySms(contact.phone, alertMessage);
            sent += 1;
          } catch {
            failed += 1;
          }
        }),
      );
    } else if (Platform.OS === 'ios') {
      // iOS: open SMS app pre-filled for each contact
      // (Apple does not allow silent SMS sending — user must tap Send)
      const { Linking } = require('react-native');
      for (const contact of contacts) {
        const encoded = encodeURIComponent(alertMessage);
        const smsUrl = `sms:${contact.phone}&body=${encoded}`;
        const canOpen = await Linking.canOpenURL(smsUrl).catch(() => false);
        if (canOpen) {
          await Linking.openURL(smsUrl).catch(() => { failed += 1; });
          sent += 1;
          // Small gap so iOS doesn't get confused opening multiple SMS urls
          await new Promise(r => setTimeout(r, 800));
        } else {
          failed += 1;
        }
      }
    }

    this.lastContactNotify = { total: contacts.length, sent, failed };
  }

  getLastContactNotificationStatus() {
    return this.lastContactNotify;
  }

  getCurrentLocation(): Promise<LocationResult | null> {
    return new Promise(resolve => {
      Geolocation.getCurrentPosition(
        pos => {
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          Geolocation.getCurrentPosition(
            pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => resolve(null),
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
          );
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 },
      );
    });
  }

  /** Create incident via unified ERA API with 401 retry. */
  async createSession(payload: SessionPayload): Promise<string> {
    const location = payload.location ?? (await this.getCurrentLocation());
    const type = inferIncidentType(payload.scenarioMessage);

    const attemptIncidentCreate = async (headers: Record<string, string>): Promise<{ ok: boolean; incidentId?: string; status?: number }> => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const url = `${API_BASE}/incidents`;
        const requestBody = {
          type,
          lat: location?.lat ?? 0,
          lng: location?.lng ?? 0,
          device_id: Platform.OS,
        };

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const data = await res.json();
        return { ok: res.ok, incidentId: data.incident_id, status: res.status };
      } catch {
        return { ok: false, status: 0 };
      }
    };

    try {
      const headers = await this.authHeaders();
      let result = await attemptIncidentCreate(headers);

      // Retry once with fresh token on 401
      if (!result.ok && result.status === 401) {
        const refreshed = await authService.refreshToken();
        if (refreshed) {
          const retryHeaders = await this.authHeaders();
          result = await attemptIncidentCreate(retryHeaders);
        }
      }

      if (result.ok && result.incidentId) {
        return result.incidentId;
      }

      throw new Error(`HTTP ${result.status ?? 'network error'}`);
    } catch {
      return `local-${Date.now()}`;
    }
  }

  async resolveSession(
    sessionId: string,
    reason: 'user_cancelled' | 'responders_notified',
  ): Promise<void> {
    if (sessionId.startsWith('local-')) return;

    try {
      const headers = await this.authHeaders();
      const status = reason === 'user_cancelled' ? 'cancelled' : 'resolved';
      await fetch(`${API_BASE}/incidents/${sessionId}/status`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status }),
      });
    } catch {
      // Resolve failed — non-critical
    }
  }

  async escalate(
    scenarioMessage: string,
    impactTimestamp: number,
  ): Promise<string> {
    const [consent, contacts, location] = await Promise.all([
      consentService.getEvidenceConsent(),
      contactsService.getAll(),
      this.getCurrentLocation(),
    ]);

    const sessionId = await this.createSession({
      scenarioMessage,
      location,
      platform: Platform.OS as 'android' | 'ios',
      impactTimestamp,
      evidenceConsent: consent,
      emergencyContacts: contacts.map(c => ({ name: c.name, phone: c.phone })),
    });

    await this.notifyEmergencyContacts(scenarioMessage, location, impactTimestamp);
    await callService.initiateEmergencyCall();

    return sessionId;
  }
}

export const emergencyService = new EmergencyService();