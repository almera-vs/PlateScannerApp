/**
 * PlateScannerApp - License Plate Scanner
 * React Native application for scanning and managing license plates
 */

import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from './src/screens/HomeScreen';
import ManualEntryScreen from './src/screens/ManualEntryScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import { RootStackParamList } from './src/types';
import db from './src/services/db';

const Stack = createNativeStackNavigator<RootStackParamList>();

function App(): React.JSX.Element {
  useEffect(() => {
    // Initialize database on app start
    db.initDB().catch(error => {
      console.error('Failed to initialize database:', error);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar barStyle="light-content" backgroundColor="#1A1A1A" />
        <Stack.Navigator
          initialRouteName="Home"
          screenOptions={{
            headerStyle: {
              backgroundColor: '#1A1A1A',
            },
            headerTintColor: '#FFFFFF',
            headerTitleStyle: {
              fontWeight: '600',
            },
            animation: 'slide_from_right',
          }}>
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{
              title: 'Skaner Tablic',
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="ManualEntry"
            component={ManualEntryScreen}
            options={{
              title: 'Wprowadź ręcznie',
              presentation: 'modal',
            }}
          />
          <Stack.Screen
            name="History"
            component={HistoryScreen}
            options={{
              title: 'Historia',
              headerShown: false,
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

export default App;
