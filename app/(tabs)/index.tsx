import { Ionicons } from '@expo/vector-icons'
import Slider from '@react-native-community/slider'
import { Audio, AVPlaybackStatus } from 'expo-av'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { Asset } from 'expo-asset'
import { applyHeartFilter } from '@/utils/audio-processor'
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'
import { getManager } from '@/utils/ble-manager'
import { Buffer } from 'buffer'
import * as DocumentPicker from 'expo-document-picker'
import { initDatabase, saveRecord } from '@/utils/database'

global.Buffer = Buffer

const STETHO_SERVICE_UUID = '0000abcd-0000-1000-8000-00805f9b34fb'
const AUDIO_CHAR_UUID = '00001234-0000-1000-8000-00805f9b34fb'
const COMMAND_CHAR_UUID = '00005678-0000-1000-8000-00805f9b34fb'
const EXPECTED_SIZE = 128000

// --- ECG WAVEFORM COMPONENT ---
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}
function gauss(x: number, mu: number, sigma: number) {
  return Math.exp(-0.5 * Math.pow((x - mu) / sigma, 2))
}
function ecgAmp(phase: number) {
  const p = 0.12 * gauss(phase, 0.16, 0.03),
    q = -0.25 * gauss(phase, 0.285, 0.012)
  const r = 1.15 * gauss(phase, 0.305, 0.008),
    s = -0.35 * gauss(phase, 0.33, 0.014)
  const t = 0.32 * gauss(phase, 0.56, 0.06)
  return p + q + r + s + t
}
function mod1(x: number) {
  return ((x % 1) + 1) % 1
}

function SyncedECG({ bpm, active }: { bpm: number; active: boolean }) {
  const [d, setD] = useState<string>(`M0 50 L300 50`)
  const scanBarX = useRef(0)
  const pointsRef = useRef<number[]>(new Array(260).fill(50))
  const beatPeriod = useMemo(() => 60 / clamp(bpm || 72, 35, 200), [bpm])

  useEffect(() => {
    if (!active) return
    let raf = 0,
      last = 0
    const tick = (tms: number) => {
      if (last === 0) last = tms
      const delta = (tms - last) / 1000
      last = tms
      scanBarX.current = (scanBarX.current + (300 / 3) * delta) % 300
      const currentIndex = Math.floor((scanBarX.current / 300) * 260)
      const phase = mod1(tms / 1000 / beatPeriod)
      pointsRef.current[currentIndex] = 50 - ecgAmp(phase) * 38
      let path = '',
        penDown = false
      for (let i = 0; i < 260; i++) {
        if (Math.abs(i - currentIndex) < 10) {
          penDown = false
          continue
        }
        const x = (i / 259) * 300
        if (!penDown) {
          path += `M${x} ${pointsRef.current[i]}`
          penDown = true
        } else path += ` L${x} ${pointsRef.current[i]}`
      }
      setD(path)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [beatPeriod, active])

  return (
    <View style={{ marginTop: 10, opacity: active ? 1 : 0.3 }}>
      <Svg height={65} width='100%' viewBox='0 0 300 100'>
        <Path
          d={d}
          fill='none'
          stroke='#3498db'
          strokeWidth='3'
          strokeLinecap='round'
        />
      </Svg>
    </View>
  )
}

function Phonocardiogram({ audioBuffer }: { audioBuffer: Buffer | null }) {
  const path = useMemo(() => {
    if (!audioBuffer || audioBuffer.length === 0) return ''
    const width = 300,
      height = 80,
      samples = []
    const step = Math.floor(audioBuffer.length / 2 / width)
    for (let i = 0; i < width; i++) {
      const byteIdx = i * step * 2
      if (byteIdx + 1 < audioBuffer.length) {
        const val = audioBuffer.readInt16LE(byteIdx)
        const y = height / 2 - (val / 32768) * (height / 2)
        samples.push(`${i},${y}`)
      }
    }
    return `M${samples.join(' L')}`
  }, [audioBuffer])
  if (!audioBuffer) return null
  return (
    <View style={styles.pcgContainer}>
      <Text style={styles.miniLabel}>Auscultation Waveform</Text>
      <Svg height='80' width='100%' viewBox='0 0 300 80'>
        <Path
          d={path}
          fill='none'
          stroke='#3498db'
          strokeWidth='1.5'
          opacity={0.6}
        />
      </Svg>
    </View>
  )
}

const softmax = (logits: number[]) => {
  const maxLogit = Math.max(...logits)
  const scores = logits.map((l) => Math.exp(l - maxLogit))
  const total = scores.reduce((a, b) => a + b)
  return scores.map((s) => s / total)
}

const runInference = async (audioData: Int16Array) => {
  try {
    const modelAsset = Asset.fromModule(
      require('../../assets/models/best_multiclass.onnx'),
    )
    const dataAsset = Asset.fromModule(
      require('../../assets/models/best_multiclass.onnx.data'),
    )
    await Promise.all([modelAsset.downloadAsync(), dataAsset.downloadAsync()])
    const modelDir = `${FileSystem.documentDirectory}ml_model/`
    await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true })
    const modelFilePath = `${modelDir}best_multiclass.onnx`
    const dataFilePath = `${modelDir}best_multiclass.onnx.data`
    await FileSystem.copyAsync({
      from: modelAsset.localUri!,
      to: modelFilePath,
    })
    await FileSystem.copyAsync({ from: dataAsset.localUri!, to: dataFilePath })
    const session = await InferenceSession.create(modelFilePath)
    const TARGET_LENGTH = 32000
    const float32Data = new Float32Array(TARGET_LENGTH)
    for (let i = 0; i < TARGET_LENGTH; i++)
      float32Data[i] = i < audioData.length ? audioData[i] / 32768.0 : 0
    const inputTensor = new Tensor('float32', float32Data, [
      1,
      1,
      TARGET_LENGTH,
    ])
    const outputs = await session.run({ [session.inputNames[0]]: inputTensor })
    return softmax(
      Array.from(outputs[session.outputNames[0]].data as Float32Array),
    )
  } catch (e) {
    console.error('ML Inference Failed:', e)
    return null
  }
}

export default function Index() {
  const [recordedBPM, setRecordedBPM] = useState<number>(0)
  const [status, setStatus] = useState('Disconnected')
  const statusRef = useRef('Disconnected')
  const bpmRef = useRef(0)

  const [connectedDevice, setConnectedDevice] = useState<any>(null)
  const [rssi, setRssi] = useState<number | null>(null)
  const [audioUri, setAudioUri] = useState<string | null>(null)
  const [isFilteredMode, setIsFilteredMode] = useState(true)
  const rawAudioUri = useRef<string | null>(null)
  const filteredAudioUri = useRef<string | null>(null)
  const rawAudioBuffer = useRef<Buffer | null>(null)
  const filteredAudioBuffer = useRef<Buffer | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const soundRef = useRef<Audio.Sound | null>(null)
  const [isTransferring, setIsTransferring] = useState(false)
  const [uiMessage, setUiMessage] = useState('Ready')
  const [progress, setProgress] = useState(0)
  const fullAudioData = useRef<Buffer>(Buffer.alloc(0))
  const localByteCount = useRef(0)
  const [mlResults, setMlResults] = useState<number[] | null>(null)
  const [isScanning, setIsScanning] = useState(false)

  const getSignalColor = (db: number | null) => {
    if (!db) return '#ccc'
    if (db > -60) return '#2ecc71'
    if (db > -80) return '#f1c40f'
    return '#e74c3c'
  }

  const connectHardware = async () => {
    const manager = getManager()
    if (isScanning || connectedDevice) return
    setIsScanning(true)
    setStatus('Searching...')
    manager.startDeviceScan(
      [STETHO_SERVICE_UUID],
      null,
      async (error, device) => {
        if (error) {
          setIsScanning(false)
          setStatus('BLE Error')
          return
        }
        if (device) {
          manager.stopDeviceScan()
          setIsScanning(false)
          try {
            const connected = await device.connect()
            await connected.discoverAllServicesAndCharacteristics()
            setConnectedDevice(connected)
            setStatus('Linked')
            statusRef.current = 'Linked'
          } catch (e) {
            setStatus('Retry...')
          }
        }
      },
    )
  }

  const triggerRemoteReset = async () => {
    if (!connectedDevice) return
    Alert.alert(
      'Reset Hardware',
      'Reboot stethoscope and disconnect Bluetooth?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              const cmd = Buffer.from('RESET').toString('base64')

              // Change "writeCharacteristicWithResponse" to "writeCharacteristicWithoutResponse"
              await connectedDevice.writeCharacteristicWithoutResponseForService(
                STETHO_SERVICE_UUID,
                COMMAND_CHAR_UUID,
                cmd,
              )

              // Since we aren't waiting for a response, we manually clean up
              setConnectedDevice(null)
              setStatus('Disconnected')
              setIsTransferring(false)
              Alert.alert('Reset Sent', 'Stethoscope is rebooting...')
            } catch (e) {
              Alert.alert(
                'Error',
                'Reset failed. Check UUID or Device connection.',
              )
            }
          },
        },
      ],
    )
  }

  useEffect(() => {
    initDatabase()
    let rssiInterval: NodeJS.Timeout
    if (connectedDevice) {
      rssiInterval = setInterval(async () => {
        try {
          const updatedDevice = await connectedDevice.readRSSI()
          setRssi(updatedDevice.rssi)
        } catch (e) {}
      }, 3000)
    }
    return () => {
      if (rssiInterval) clearInterval(rssiInterval)
      getManager().stopDeviceScan()
    }
  }, [connectedDevice])

  const onPlaybackStatusUpdate = (s: AVPlaybackStatus) => {
    if (s.isLoaded) {
      setPosition(s.positionMillis)
      setDuration(s.durationMillis || 0)
      setIsPlaying(s.isPlaying)
    }
  }

  const switchMode = async (toFiltered: boolean) => {
    const newUri = toFiltered ? filteredAudioUri.current : rawAudioUri.current
    if (!newUri || toFiltered === isFilteredMode) return
    setIsFilteredMode(toFiltered)
    setAudioUri(newUri)
    if (soundRef.current) {
      const s = await soundRef.current.getStatusAsync()
      if (s.isLoaded) {
        const currentPos = s.positionMillis
        const wasPlaying = s.isPlaying
        await soundRef.current.unloadAsync()
        const { sound } = await Audio.Sound.createAsync(
          { uri: newUri },
          { shouldPlay: wasPlaying, positionMillis: currentPos },
          onPlaybackStatusUpdate,
        )
        soundRef.current = sound
      }
    }
  }

  const finalizeAudio = async () => {
    try {
      if (soundRef.current) await soundRef.current.unloadAsync()
      const rawData = fullAudioData.current.slice(0, EXPECTED_SIZE)
      if (!rawData || rawData.length < 4) return

      const pcmData = new Int16Array(rawData.length / 4)
      for (let i = 0, pcmIdx = 0; i < rawData.length; i += 4) {
        let rawVal = rawData.readUInt16LE(i) & 0x0fff
        pcmData[pcmIdx++] = (rawVal - 2048) << 4
      }

      const rawPath = `${FileSystem.cacheDirectory}Raw_${Date.now()}.wav`
      const rawHeader = createWavHeader(pcmData.byteLength, 4000)
      await FileSystem.writeAsStringAsync(
        rawPath,
        Buffer.concat([rawHeader, Buffer.from(pcmData.buffer)]).toString(
          'base64',
        ),
        { encoding: 'base64' },
      )
      rawAudioUri.current = rawPath
      rawAudioBuffer.current = Buffer.from(pcmData.buffer)

      const filteredSamples = applyHeartFilter(pcmData)
      const filteredBuffer = Buffer.from(filteredSamples.buffer)
      const filteredPath = `${FileSystem.cacheDirectory}Filtered_${Date.now()}.wav`
      const filteredHeader = createWavHeader(filteredBuffer.length, 4000)
      await FileSystem.writeAsStringAsync(
        filteredPath,
        Buffer.concat([filteredHeader, filteredBuffer]).toString('base64'),
        { encoding: 'base64' },
      )
      filteredAudioUri.current = filteredPath
      filteredAudioBuffer.current = filteredBuffer

      const finalStatus = statusRef.current.trim()
      const finalBPM = bpmRef.current // FIX: Grabbing BPM from Ref for accuracy
      let resultsToSave = null

      if (finalStatus === '1') {
        setUiMessage('Classifying Murmur...')
        const results = await runInference(filteredSamples)
        if (results) {
          setMlResults(results)
          resultsToSave = results
        }
      } else {
        setMlResults(null)
      }

      setAudioUri(isFilteredMode ? filteredPath : rawPath)

      saveRecord({
        bpm: finalBPM,
        status: finalStatus,
        audioUri: isFilteredMode ? filteredPath : rawPath,
        earlyMurmur: resultsToSave ? resultsToSave[0] : 0,
        holosystolic: resultsToSave ? resultsToSave[1] : 0,
        midLateMurmur: resultsToSave ? resultsToSave[2] : 0,
      })
    } catch (err) {
      console.error('Finalize Error:', err)
    } finally {
      setIsTransferring(false)
      setProgress(0)
      localByteCount.current = 0
      setUiMessage('Ready')
    }
  }

  const createWavHeader = (dataLength: number, sampleRate: number) => {
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + dataLength, 4) // Standard Method
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(sampleRate * 2, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(dataLength, 40)
    return header
  }

  const startMonitoring = async () => {
    if (!connectedDevice) return
    try {
      await connectedDevice.discoverAllServicesAndCharacteristics()
      connectedDevice.monitorCharacteristicForService(
        STETHO_SERVICE_UUID,
        AUDIO_CHAR_UUID,
        (err, char) => {
          if (err || !char?.value) return
          const chunk = Buffer.from(char.value, 'base64')
          if (chunk[0] === 0xfe && chunk.length < 5) {
            setIsTransferring(true)
            setUiMessage('Syncing Hardware...')
            localByteCount.current = 0
            fullAudioData.current = Buffer.alloc(0)
            setAudioUri(null)
            setMlResults(null)
            statusRef.current = 'Linked'
            bpmRef.current = 0
            return
          }
          if (chunk[0] === 0xff && chunk.length < 10) {
            const rawStatus = chunk[1].toString()
            const rawBPM = chunk[2]
            statusRef.current = rawStatus
            bpmRef.current = rawBPM // Update Refs instantly
            setStatus(rawStatus)
            setRecordedBPM(rawBPM)
            return
          }
          fullAudioData.current = Buffer.concat([fullAudioData.current, chunk])
          localByteCount.current += chunk.length
          setProgress(Math.min(localByteCount.current / EXPECTED_SIZE, 1))
          if (localByteCount.current >= EXPECTED_SIZE) {
            finalizeAudio()
          }
        },
      )
    } catch (e) {
      setStatus('Sync Error')
      setIsTransferring(false)
    }
  }

  useEffect(() => {
    if (connectedDevice) startMonitoring()
  }, [connectedDevice])

  return (
    <SafeAreaView style={styles.container}>
      <Modal visible={isTransferring} transparent animationType='fade'>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ActivityIndicator size='large' color='#3498db' />
            <Text style={styles.modalTitle}>Processing Recording</Text>
            <Text style={styles.modalSubtitle}>{uiMessage}</Text>
            <View style={styles.modalProgressContainer}>
              <View
                style={[
                  styles.modalProgressBar,
                  { width: `${progress * 100}%` },
                ]}
              />
            </View>
            <Text style={styles.modalPercentage}>
              {Math.round(progress * 100)}%
            </Text>

            <TouchableOpacity
              onPress={triggerRemoteReset}
              style={styles.modalResetBtn}
            >
              <Ionicons name='refresh-circle' size={20} color='#ff4444' />
              <Text style={styles.modalResetText}>Stuck? Emergency Reset</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>CardioScope</Text>
            <Text
              style={[
                styles.subtitle,
                { color: connectedDevice ? '#3498db' : '#FF3B30' },
              ]}
            >
              {status.trim() === '1'
                ? 'Abnormal Detected'
                : status.trim() === '0'
                  ? 'Normal Detected'
                  : status}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {connectedDevice && (
              <TouchableOpacity
                onPress={triggerRemoteReset}
                style={[
                  styles.connectButton,
                  { backgroundColor: '#FF3B30', marginRight: 10 },
                ]}
              >
                <Ionicons name='refresh' size={16} color='#FFF' />
              </TouchableOpacity>
            )}
            {!connectedDevice && (
              <TouchableOpacity
                onPress={connectHardware}
                style={styles.connectButton}
              >
                <Ionicons name='bluetooth' size={16} color='#FFF' />
                <Text style={styles.connectButtonText}>
                  {isScanning ? 'Scanning' : 'Connect'}
                </Text>
              </TouchableOpacity>
            )}
            {connectedDevice && (
              <View
                style={[
                  styles.signalBadge,
                  { borderColor: getSignalColor(rssi) },
                ]}
              >
                <Ionicons
                  name='bluetooth'
                  size={14}
                  color={getSignalColor(rssi)}
                />
                <Text
                  style={[styles.signalText, { color: getSignalColor(rssi) }]}
                >
                  {rssi || '--'} dBm
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      <ScrollView style={styles.dashboard}>
        <View style={styles.darkCard}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Auscultation Analysis</Text>
            <Ionicons
              name='pulse'
              size={20}
              color={isPlaying ? '#3498db' : '#555'}
            />
          </View>
          {audioUri ? (
            <View>
              <Text style={styles.hrValueText}>
                {recordedBPM || '--'}{' '}
                <Text style={{ fontSize: 22, color: '#3498db' }}>bpm</Text>
              </Text>
              <SyncedECG bpm={recordedBPM || 72} active={isPlaying} />
              <Phonocardiogram
                audioBuffer={
                  isFilteredMode
                    ? filteredAudioBuffer.current
                    : rawAudioBuffer.current
                }
              />
              <View style={styles.toggleContainer}>
                <TouchableOpacity
                  onPress={() => switchMode(false)}
                  style={[
                    styles.toggleBtn,
                    !isFilteredMode && styles.toggleBtnActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.toggleText,
                      !isFilteredMode && styles.toggleTextActive,
                    ]}
                  >
                    RAW
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => switchMode(true)}
                  style={[
                    styles.toggleBtn,
                    isFilteredMode && styles.toggleBtnActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.toggleText,
                      isFilteredMode && styles.toggleTextActive,
                    ]}
                  >
                    FILTERED
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.timeRow}>
                <Text style={styles.timeText}>
                  {Math.floor(position / 1000)}s
                </Text>
                <Text style={styles.timeText}>
                  {Math.floor(duration / 1000)}.0s
                </Text>
              </View>
              <Slider
                style={{ width: '100%', height: 40 }}
                minimumValue={0}
                maximumValue={duration}
                value={position}
                minimumTrackTintColor='#3498db'
                thumbTintColor='#3498db'
                onSlidingComplete={async (v) => {
                  if (soundRef.current)
                    await soundRef.current.setPositionAsync(v)
                }}
              />
              <TouchableOpacity
                onPress={async () => {
                  if (!audioUri) return
                  if (soundRef.current) {
                    const s = await soundRef.current.getStatusAsync()
                    if (s.isLoaded) {
                      isPlaying
                        ? await soundRef.current.pauseAsync()
                        : await soundRef.current.playAsync()
                      return
                    }
                  }
                  const { sound } = await Audio.Sound.createAsync(
                    { uri: audioUri },
                    { shouldPlay: true },
                    onPlaybackStatusUpdate,
                  )
                  soundRef.current = sound
                }}
                style={styles.playBtn}
              >
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={32}
                  color='#FFF'
                />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <Ionicons name='mic-circle' size={64} color='#222' />
              <Text style={styles.placeholder}>
                Waiting for stethoscope signal...
              </Text>
            </View>
          )}
        </View>

        {audioUri && !isTransferring && (
          <View>
            {status.trim() === '1' && mlResults ? (
              <View style={styles.mlResultsCard}>
                <Text style={styles.cardTitle}>Detailed Triage Results</Text>
                <View style={{ marginTop: 15 }}>
                  {[
                    {
                      label: 'Early Murmur',
                      value: mlResults[0],
                      color: '#3498db',
                    },
                    {
                      label: 'Holosystolic',
                      value: mlResults[1],
                      color: '#e67e22',
                    },
                    {
                      label: 'Mid/Late Murmur',
                      value: mlResults[2],
                      color: '#e74c3c',
                    },
                  ].map((item, idx) => (
                    <View key={idx} style={styles.probabilityRow}>
                      <Text style={styles.probLabel}>{item.label}</Text>
                      <View style={styles.probBarContainer}>
                        <View
                          style={[
                            styles.probBar,
                            {
                              width: `${item.value * 100}%`,
                              backgroundColor: item.color,
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.probValue}>
                        {(item.value * 100).toFixed(1)}%
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : status.trim() === '0' ? (
              <View style={styles.normalResultCard}>
                <View style={styles.statusBadge}>
                  <Ionicons name='checkmark-circle' size={24} color='#2ecc71' />
                  <Text style={styles.normalTitle}>Healthy Heart</Text>
                </View>
                <Text style={styles.normalSub}>
                  The automated triage did not detect significant murmur
                  patterns.
                </Text>
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.buttonRow}>
          <TouchableOpacity
            onPress={async () => {
              if (audioUri && (await Sharing.isAvailableAsync()))
                await Sharing.shareAsync(audioUri)
            }}
            style={[styles.primaryButton, { flex: 1, marginRight: 10 }]}
          >
            <Text style={styles.primaryButtonText}>Export</Text>
            <Ionicons name='share-outline' size={20} color='white' />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              try {
                const result = await DocumentPicker.getDocumentAsync({
                  type: 'audio/x-wav',
                  copyToCacheDirectory: true,
                })
                if (result.canceled || !result.assets.length) return
                setIsTransferring(true)
                setUiMessage('Loading Upload...')
                const fileAsset = result.assets[0]
                const base64Data = await FileSystem.readAsStringAsync(
                  fileAsset.uri,
                  { encoding: FileSystem.EncodingType.Base64 },
                )
                const rawAudio = Buffer.from(base64Data, 'base64').slice(44)
                const rawSamples = new Int16Array(
                  rawAudio.buffer,
                  rawAudio.byteOffset,
                  rawAudio.byteLength / 2,
                )
                rawAudioUri.current = fileAsset.uri
                rawAudioBuffer.current = Buffer.from(rawSamples.buffer)
                const filteredSamples = applyHeartFilter(rawSamples)
                const filteredBuffer = Buffer.from(filteredSamples.buffer)
                const filteredPath = `${FileSystem.cacheDirectory}Filtered_Up_${Date.now()}.wav`
                const header = createWavHeader(filteredBuffer.length, 4000)
                await FileSystem.writeAsStringAsync(
                  filteredPath,
                  Buffer.concat([header, filteredBuffer]).toString('base64'),
                  { encoding: 'base64' },
                )
                filteredAudioUri.current = filteredPath
                filteredAudioBuffer.current = filteredBuffer
                setAudioUri(filteredPath)
                const results = await runInference(filteredSamples)
                if (results) setMlResults(results)
              } catch (error) {
                Alert.alert('Upload Error', 'Failed to process file.')
              } finally {
                setIsTransferring(false)
              }
            }}
            style={[styles.secondaryButton, { flex: 1 }]}
          >
            <Text style={styles.secondaryButtonText}>Upload</Text>
            <Ionicons name='cloud-upload-outline' size={20} color='#3498db' />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  header: { paddingHorizontal: 25, paddingTop: 20 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: { fontSize: 32, fontWeight: '900' },
  subtitle: { fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase' },
  connectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3498db',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 5,
  },
  connectButtonText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 6,
  },
  signalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 5,
  },
  signalText: { fontSize: 10, fontWeight: 'bold', marginLeft: 4 },
  dashboard: { padding: 20 },
  darkCard: {
    backgroundColor: '#000',
    borderRadius: 24,
    padding: 25,
    marginBottom: 20,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  cardTitle: { color: '#888', fontWeight: '600' },
  hrValueText: { color: '#FFF', fontSize: 58, fontWeight: 'bold' },
  playBtn: {
    alignSelf: 'center',
    backgroundColor: '#3498db',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  primaryButton: {
    backgroundColor: '#3498db',
    padding: 18,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginRight: 10,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#3498db',
    padding: 18,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#3498db',
    fontSize: 16,
    fontWeight: 'bold',
    marginRight: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  placeholder: {
    color: '#555',
    textAlign: 'center',
    marginTop: 15,
    paddingHorizontal: 20,
  },
  pcgContainer: { marginBottom: 10, marginTop: 5 },
  miniLabel: {
    color: '#3498db',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  mlResultsCard: {
    backgroundColor: '#1C1C1E',
    borderRadius: 24,
    padding: 20,
    marginBottom: 20,
  },
  probabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  probLabel: { color: '#FFF', width: 105, fontSize: 13, fontWeight: '600' },
  probBarContainer: {
    flex: 1,
    height: 8,
    backgroundColor: '#333',
    borderRadius: 4,
    marginHorizontal: 10,
    overflow: 'hidden',
  },
  probBar: { height: '100%', borderRadius: 4 },
  probValue: { color: '#888', width: 45, fontSize: 12, textAlign: 'right' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    backgroundColor: '#1C1C1E',
    padding: 35,
    borderRadius: 28,
    alignItems: 'center',
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 20,
  },
  modalSubtitle: {
    color: '#888',
    fontSize: 14,
    marginTop: 5,
    textAlign: 'center',
  },
  modalProgressContainer: {
    width: '100%',
    height: 6,
    backgroundColor: '#333',
    borderRadius: 3,
    marginTop: 25,
    overflow: 'hidden',
  },
  modalProgressBar: { height: '100%', backgroundColor: '#3498db' },
  modalPercentage: {
    color: '#3498db',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 10,
  },
  modalResetBtn: {
    marginTop: 30,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
  },
  modalResetText: {
    color: '#ff4444',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  timeText: { color: '#555', fontSize: 12 },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    padding: 4,
    marginBottom: 15,
    alignSelf: 'center',
  },
  toggleBtn: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 8 },
  toggleBtnActive: { backgroundColor: '#3498db' },
  toggleText: { color: '#888', fontSize: 12, fontWeight: 'bold' },
  toggleTextActive: { color: '#FFF' },
  normalResultCard: {
    backgroundColor: '#fafffb',
    borderWidth: 2,
    borderColor: '#2ecc71',
    borderRadius: 24,
    padding: 25,
    marginBottom: 20,
    alignItems: 'center',
  },
  statusBadge: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  normalTitle: {
    color: '#2ecc71',
    fontSize: 20,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  normalSub: {
    color: '#555',
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
})
