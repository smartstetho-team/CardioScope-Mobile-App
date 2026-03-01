import { Tabs } from 'expo-router'
import React from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'

export default function TabLayout() {
  const colorScheme = useColorScheme()

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name='index'
        options={{
          title: 'Monitor',
          tabBarIcon: ({ color }) => (
            <Ionicons size={28} name='pulse' color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name='history'
        options={{
          title: 'History',
          tabBarIcon: ({ color }) => (
            <Ionicons size={28} name='time' color={color} />
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
