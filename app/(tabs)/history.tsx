import React, { useState, useEffect } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { getAllRecords, deleteRecord, StethoRecord } from '@/utils/database'
import { useIsFocused } from '@react-navigation/native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Audio, AVPlaybackStatus } from 'expo-av'
import * as Sharing from 'expo-sharing'
import * as FileSystem from 'expo-file-system'
import Slider from '@react-native-community/slider'

export default function HistoryScreen() {
  const [records, setRecords] = useState<StethoRecord[]>([])
  const [filteredRecords, setFilteredRecords] = useState<StethoRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterAbnormal, setFilterAbnormal] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [sound, setSound] = useState<Audio.Sound | null>(null)
  const [isPlayingId, setIsPlayingId] = useState<number | null>(null)
  const [playbackPosition, setPlaybackPosition] = useState(0)
  const [playbackDuration, setPlaybackDuration] = useState(0)
  const isFocused = useIsFocused()

  useEffect(() => {
    if (isFocused) loadData()
    else stopSound()
  }, [isFocused])

  useEffect(() => {
    applyFilters(records, searchQuery, filterAbnormal)
  }, [searchQuery, filterAbnormal, records])

  const loadData = () => {
    const data = getAllRecords()
    setRecords(data)
  }

  const applyFilters = (
    data: StethoRecord[],
    query: string,
    onlyAbnormal: boolean,
  ) => {
    let filtered = data
    if (onlyAbnormal) filtered = filtered.filter((r) => r.status === '1')
    if (query) {
      filtered = filtered.filter(
        (r) =>
          r.bpm.toString().includes(query) ||
          new Date(r.timestamp).toLocaleDateString().includes(query),
      )
    }
    setFilteredRecords(filtered)
  }

  const handleClearAll = () => {
    Alert.alert('Clear History', 'Permanently delete all recordings?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear All',
        style: 'destructive',
        onPress: () => {
          records.forEach((r) => deleteRecord(r.id))
          loadData()
        },
      },
    ])
  }

  const stopSound = async () => {
    if (sound) {
      await sound.unloadAsync()
      setSound(null)
      setIsPlayingId(null)
    }
  }

  const playRecording = async (item: StethoRecord) => {
    if (isPlayingId === item.id) {
      await stopSound()
      return
    }
    await stopSound()
    try {
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: item.audioUri },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded) {
            setPlaybackPosition(status.positionMillis)
            setPlaybackDuration(status.durationMillis || 0)
            if (status.didJustFinish) setIsPlayingId(null)
          }
        },
      )
      setSound(newSound)
      setIsPlayingId(item.id)
    } catch (e) {
      Alert.alert('Error', 'File missing.')
    }
  }

  const renderMurmurBar = (label: string, value: number, color: string) => (
    <View style={styles.probRow}>
      <Text style={styles.probLabel}>{label}</Text>
      <View style={styles.barContainer}>
        <View
          style={[
            styles.bar,
            { width: `${(value || 0) * 100}%`, backgroundColor: color },
          ]}
        />
      </View>
      <Text style={styles.probVal}>{((value || 0) * 100).toFixed(1)}%</Text>
    </View>
  )

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>History</Text>
          {records.length > 0 && (
            <TouchableOpacity onPress={handleClearAll} style={styles.clearBtn}>
              <Text style={styles.clearText}>Clear All</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.searchRow}>
          <View style={styles.searchContainer}>
            <Ionicons name='search' size={18} color='#aaa' />
            <TextInput
              style={styles.searchInput}
              placeholder='Search...'
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholderTextColor='#aaa'
            />
          </View>
          <TouchableOpacity
            style={[
              styles.filterToggle,
              filterAbnormal && styles.filterToggleActive,
            ]}
            onPress={() => setFilterAbnormal(!filterAbnormal)}
          >
            <Ionicons
              name='warning'
              size={20}
              color={filterAbnormal ? '#FFF' : '#ff4444'}
            />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={filteredRecords}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => {
          const isExpanded = selectedId === item.id
          const isPlaying = isPlayingId === item.id
          const dateObj = new Date(item.timestamp)
          const dateStr = dateObj.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
          const timeStr = dateObj.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })

          return (
            <View style={[styles.card, isExpanded && styles.cardExpanded]}>
              <TouchableOpacity
                style={styles.cardHeader}
                onPress={() => setSelectedId(isExpanded ? null : item.id)}
              >
                <View>
                  <Text style={styles.date}>
                    {dateStr} • {timeStr}
                  </Text>
                  <Text style={styles.subtext}>
                    {item.bpm || '--'} BPM •
                    <Text
                      style={{
                        color: item.status === '1' ? '#ff4444' : '#2ecc71',
                        fontWeight: 'bold',
                      }}
                    >
                      {item.status === '1' ? ' Abnormal' : ' Normal'}
                    </Text>
                  </Text>
                </View>
                <Ionicons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color='#888'
                />
              </TouchableOpacity>

              {isExpanded && (
                <View style={styles.details}>
                  {item.status === '1' ? (
                    <View style={styles.mlSection}>
                      <Text style={styles.detailTitle}>
                        Murmur Classification
                      </Text>
                      {renderMurmurBar(
                        'Early Murmur',
                        item.earlyMurmur,
                        '#3498db',
                      )}
                      {renderMurmurBar(
                        'Holosystolic',
                        item.holosystolic,
                        '#e67e22',
                      )}
                      {renderMurmurBar(
                        'Mid/Late',
                        item.midLateMurmur,
                        '#e74c3c',
                      )}
                    </View>
                  ) : (
                    <Text style={styles.normalNote}>
                      No abnormalities detected.
                    </Text>
                  )}

                  {isPlaying && (
                    <View style={styles.playbackContainer}>
                      <Slider
                        style={{ width: '100%', height: 20 }}
                        minimumValue={0}
                        maximumValue={playbackDuration}
                        value={playbackPosition}
                        minimumTrackTintColor='#3498db'
                        thumbTintColor='#3498db'
                        onSlidingComplete={async (v) => {
                          if (sound) await sound.setPositionAsync(v)
                        }}
                      />
                    </View>
                  )}
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={styles.playBtn}
                      onPress={() => playRecording(item)}
                    >
                      <Ionicons
                        name={isPlaying ? 'stop' : 'play'}
                        size={18}
                        color='#FFF'
                      />
                      <Text style={styles.btnText}>
                        {isPlaying ? 'Stop' : 'Play'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        deleteRecord(item.id)
                        loadData()
                      }}
                    >
                      <Ionicons
                        name='trash-outline'
                        size={22}
                        color='#ff4444'
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )
        }}
        ListEmptyComponent={<Text style={styles.empty}>No records found.</Text>}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  header: { padding: 25, paddingBottom: 15 },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  title: { fontSize: 32, fontWeight: '900' },
  clearBtn: { padding: 8 },
  clearText: { color: '#ff4444', fontWeight: 'bold' },
  searchRow: { flexDirection: 'row', alignItems: 'center' },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginRight: 10,
  },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 15 },
  filterToggle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ff4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterToggleActive: { backgroundColor: '#ff4444' },
  card: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: '#f9f9f9',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  cardExpanded: { borderColor: '#3498db', backgroundColor: '#fff' },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  date: { fontWeight: 'bold', fontSize: 15, color: '#222' },
  subtext: { color: '#666', marginTop: 4, fontSize: 13 },
  details: {
    marginTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 15,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3498db',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 10,
  },
  btnText: { color: '#FFF', fontWeight: 'bold', marginLeft: 6 },
  empty: { color: '#ccc', fontSize: 16, marginTop: 100, textAlign: 'center' },
  playbackContainer: { marginBottom: 10 },
  probRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  probLabel: { width: 85, fontSize: 12, color: '#444' },
  barContainer: {
    flex: 1,
    height: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 3,
    marginHorizontal: 10,
    overflow: 'hidden',
  },
  bar: { height: '100%', borderRadius: 3 },
  probVal: { width: 45, fontSize: 11, fontWeight: 'bold', textAlign: 'right' },
  normalNote: {
    color: '#2ecc71',
    fontSize: 13,
    marginBottom: 15,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  detailTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#aaa',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  mlSection: { marginBottom: 15 },
})
