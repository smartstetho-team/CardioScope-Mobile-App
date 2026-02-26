import { Tabs } from 'expo-router'
import React from 'react'
import { Ionicons } from '@expo/vector-icons' // Standard with Expo
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'

export default function TabLayout() {
  const colorScheme = useColorScheme()

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        // Removed tabBarButton: HapticTab to stop the crash
      }}
    >
      <Tabs.Screen
        name='index'
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <Ionicons size={28} name='home' color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name='settings'
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => (
            <Ionicons size={28} name='settings' color={color} />
          ),
        }}
      />
    </Tabs>
  )
}
