import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { IconSymbol } from '@/components/ui/icon-symbol'
import { Buffer } from 'buffer'
import React, { useEffect, useState } from 'react'
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  TouchableOpacity,
  View,
} from 'react-native'

// BLE Imports
import BleScannerModal from '@/components/BleScannerModal'
import { getManager } from '@/utils/ble-manager'

// Prevent auto-deletion and verify tools
const BLE_TOOLS = { manager: getManager(), buffer: Buffer }

const COLORS = {
  primary: '#3498db',
  background: '#FFFFFF',
  card: '#000000',
  textHeader: '#000000',
  textMuted: '#8E8E93',
  danger: '#FF3B30',
}

export default function SettingsScreen() {
  const [isCloudSync, setIsCloudSync] = useState(true)
  const [isNoiseCancelling, setIsNoiseCancelling] = useState(false)
  const [isScannerVisible, setIsScannerVisible] = useState(false)

  // Hardware States
  const [connectedDevice, setConnectedDevice] = useState<any>(null)
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null)
  const [acousticMode, setAcousticMode] = useState('Diaphragm')

  // 1. SYNC CONNECTION STATUS
  // This ensures that if you connect on the Home screen, this screen sees it too
  useEffect(() => {
    const manager = getManager()
    if (!manager) return

    const checkConn = async () => {
      try {
        const devices = await manager.connectedDevices(['180D'])
        if (devices.length > 0) {
          if (!connectedDevice || connectedDevice.id !== devices[0].id) {
            setConnectedDevice(devices[0])
          }
        } else {
          setConnectedDevice(null)
          setBatteryLevel(null)
        }
      } catch (e) {
        console.warn('Settings sync failed', e)
      }
    }

    const interval = setInterval(checkConn, 3000)
    checkConn()
    return () => clearInterval(interval)
  }, [connectedDevice])

  // 2. MONITOR BATTERY UPDATES
  useEffect(() => {
    if (!connectedDevice) return

    let batSub: any = null

    const startMonitoring = async () => {
      try {
        await connectedDevice.discoverAllServicesAndCharacteristics()

        batSub = connectedDevice.monitorCharacteristicForService(
          '0000180F-0000-1000-8000-00805f9b34fb', // Battery Service
          '00002A19-0000-1000-8000-00805f9b34fb', // Battery Level Char
          (error: any, char: any) => {
            if (error) return
            if (char?.value) {
              const level = Buffer.from(char.value, 'base64').readUInt8(0)
              setBatteryLevel(level)
            }
          },
        )
      } catch (e) {
        console.error('Battery stream setup failed', e)
      }
    }

    startMonitoring()
    return () => {
      if (batSub) batSub.remove()
    }
  }, [connectedDevice])

  // --- UI Components ---
  const Section = ({
    title,
    children,
  }: {
    title: string
    children: React.ReactNode
  }) => (
    <View style={styles.section}>
      <ThemedText style={styles.sectionHeader}>{title}</ThemedText>
      <View style={styles.card}>{children}</View>
    </View>
  )

  const SettingRow = ({
    icon,
    label,
    value,
    isLast = false,
    onPress,
    toggle,
    valueColor,
  }: any) => (
    <TouchableOpacity
      style={[styles.row, isLast && { borderBottomWidth: 0 }]}
      onPress={onPress}
      disabled={!onPress && toggle === undefined}
    >
      <View style={styles.rowLeft}>
        <View style={styles.iconContainer}>
          <IconSymbol name={icon} size={18} color={COLORS.primary} />
        </View>
        <ThemedText style={styles.rowLabel}>{label}</ThemedText>
      </View>
      <View style={styles.rowRight}>
        {toggle !== undefined ? (
          <Switch
            value={toggle}
            onValueChange={onPress}
            trackColor={{ false: '#333', true: COLORS.primary }}
            ios_backgroundColor='#333'
          />
        ) : (
          <>
            <ThemedText
              style={[styles.rowValue, valueColor && { color: valueColor }]}
            >
              {value}
            </ThemedText>
            <IconSymbol name='chevron.right' size={14} color='#444' />
          </>
        )}
      </View>
    </TouchableOpacity>
  )

  const handleUnpairAndReset = () => {
    Alert.alert(
      'Unpair & Reset',
      'This will disconnect the stethoscope. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair',
          style: 'destructive',
          onPress: async () => {
            if (connectedDevice) {
              try {
                const manager = getManager()
                await manager.cancelDeviceConnection(connectedDevice.id)
                setConnectedDevice(null)
                setBatteryLevel(null)
              } catch (e) {
                setConnectedDevice(null)
              }
            }
          },
        },
      ],
    )
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText style={styles.headerTitle}>Settings</ThemedText>
        <ThemedText style={styles.subtitle}>CardioScope Platform</ThemedText>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Section title='DEVICE STATUS'>
          <SettingRow
            icon='stethoscope'
            label='Hardware Link'
            value={
              connectedDevice
                ? connectedDevice.name || 'Connected'
                : 'Not Linked'
            }
            valueColor={connectedDevice ? COLORS.primary : COLORS.textMuted}
            onPress={() => setIsScannerVisible(true)}
          />
          <SettingRow
            icon={
              batteryLevel && batteryLevel < 20 ? 'battery.25' : 'battery.100'
            }
            label='Stetho Battery'
            value={batteryLevel !== null ? `${batteryLevel}%` : '--'}
            valueColor={
              batteryLevel && batteryLevel < 20
                ? COLORS.danger
                : COLORS.textMuted
            }
            isLast={true}
          />
        </Section>

        <Section title='SIGNAL PROCESSING'>
          <SettingRow
            icon='waveform.path'
            label='Active Noise Control'
            toggle={isNoiseCancelling}
            onPress={() => setIsNoiseCancelling(!isNoiseCancelling)}
          />
          <SettingRow
            icon='tuningfork'
            label='Acoustic Mode'
            value={acousticMode}
            onPress={() => {
              // Toggle mode locally for now
              setAcousticMode((prev) =>
                prev === 'Diaphragm' ? 'Bell' : 'Diaphragm',
              )
            }}
            isLast={true}
          />
        </Section>

        <Section title='DATA MANAGEMENT'>
          <SettingRow
            icon='icloud.fill'
            label='Cloud Backup'
            toggle={isCloudSync}
            onPress={() => setIsCloudSync(!isCloudSync)}
          />
          <SettingRow
            icon='lock.shield.fill'
            label='Encryption'
            value='AES-256'
            isLast={true}
          />
        </Section>

        <TouchableOpacity
          style={styles.dangerZone}
          onPress={handleUnpairAndReset}
        >
          <ThemedText style={styles.dangerText}>
            Unpair & Reset Device
          </ThemedText>
        </TouchableOpacity>

        <ThemedText style={styles.versionLabel}>
          Version 1.0.2 • Powered by SmartStetho
        </ThemedText>
      </ScrollView>

      <Modal
        animationType='slide'
        presentationStyle='pageSheet'
        visible={isScannerVisible}
      >
        <BleScannerModal
          onDeviceConnected={(device: any) => {
            setConnectedDevice(device)
            setIsScannerVisible(false)
          }}
          onClose={() => setIsScannerVisible(false)}
        />
      </Modal>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingTop: Platform.OS === 'ios' ? 80 : 50,
    paddingHorizontal: 25,
    paddingBottom: 15,
    backgroundColor: COLORS.background,
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: '900',
    color: COLORS.textHeader,
    letterSpacing: -1,
    lineHeight: 42,
  },
  subtitle: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 4,
  },
  scrollContent: { paddingBottom: 40 },
  section: { marginTop: 24, paddingHorizontal: 20 },
  sectionHeader: {
    fontSize: 12,
    color: COLORS.textHeader,
    marginBottom: 10,
    marginLeft: 4,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  card: { backgroundColor: COLORS.card, borderRadius: 20, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center' },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#1c1c1e',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  rowLabel: { fontSize: 16, color: '#FFFFFF', fontWeight: '600' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowValue: { fontSize: 16, color: COLORS.textMuted, fontWeight: '500' },
  dangerZone: {
    marginTop: 32,
    marginHorizontal: 20,
    backgroundColor: '#000',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1c1c1e',
  },
  dangerText: { color: COLORS.danger, fontSize: 16, fontWeight: '700' },
  versionLabel: {
    textAlign: 'center',
    marginTop: 25,
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
})
