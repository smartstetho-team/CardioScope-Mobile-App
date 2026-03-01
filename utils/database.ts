import * as SQLite from 'expo-sqlite'

// Open or create the database
const db = SQLite.openDatabaseSync('stetho_records.db')

export interface StethoRecord {
  id: number
  timestamp: string
  bpm: number
  status: string
  audioUri: string
  earlyMurmur: number
  holosystolic: number
  midLateMurmur: number
}

export const initDatabase = () => {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT,
      bpm INTEGER,
      status TEXT,
      audioUri TEXT,
      earlyMurmur REAL,
      holosystolic REAL,
      midLateMurmur REAL
    );
  `)
}

export const saveRecord = (record: Omit<StethoRecord, 'id' | 'timestamp'>) => {
  const timestamp = new Date().toISOString()
  db.runSync(
    'INSERT INTO records (timestamp, bpm, status, audioUri, earlyMurmur, holosystolic, midLateMurmur) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      timestamp,
      record.bpm,
      record.status,
      record.audioUri,
      record.earlyMurmur,
      record.holosystolic,
      record.midLateMurmur,
    ],
  )
}

export const getAllRecords = (): StethoRecord[] => {
  return db.getAllSync<StethoRecord>('SELECT * FROM records ORDER BY id DESC')
}

export const deleteRecord = (id: number) => {
  db.runSync('DELETE FROM records WHERE id = ?', [id])
}
