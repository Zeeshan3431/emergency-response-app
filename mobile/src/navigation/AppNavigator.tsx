/**
 * AppNavigator.tsx
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { EmergencyProvider } from '../context/EmergencyContext';
import HomeScreen from '../screens/HomeScreen';
import ConfirmationScreen from '../screens/ConfirmationScreen';
import EmergencyActiveScreen from '../screens/EmergencyActiveScreen';
import OnboardingScreen from '../screens/OnboardingScreen';

export type RootStackParamList = {
  Onboarding: undefined;
  Home: undefined;
  Confirmation: undefined;
  EmergencyActive: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const AppNavigator: React.FC = () => {
  // Start with Onboarding. Onboarding will check storage and redirect if needed.
  const initialRoute = 'Onboarding';

  return (
    <EmergencyProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName={initialRoute}
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_bottom',
          }}>

          <Stack.Screen 
            name="Onboarding" 
            component={OnboardingScreen} 
            options={{ animation: 'fade' }}
          />



          <Stack.Screen name="Home" component={HomeScreen} />

          <Stack.Screen
            name="Confirmation"
            component={ConfirmationScreen}
            options={{ gestureEnabled: false }}
          />

          <Stack.Screen
            name="EmergencyActive"
            component={EmergencyActiveScreen}
            options={{ gestureEnabled: false }}
          />

        </Stack.Navigator>
      </NavigationContainer>
    </EmergencyProvider>
  );
};

export default AppNavigator;