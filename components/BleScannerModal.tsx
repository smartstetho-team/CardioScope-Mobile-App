import { getManager } from "@/utils/ble-manager";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { Device } from "react-native-ble-plx";

export default function BleScannerModal({
  onDeviceConnected,
  onClose,
  connectedDevice,
}: any) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      startScan();
    }, 500);
    return () => {
      clearTimeout(timer);
      getManager()?.stopDeviceScan();
    };
  }, []);

  const startScan = async () => {
    const manager = getManager();
    if (!manager) return;

    setDevices([]);
    setScanning(true);
    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        setScanning(false);
        return;
      }
      if (device) {
        setDevices((prev) => {
          if (prev.find((d) => d.id === device.id)) return prev;
          // Filter out the device if it's already the one we are connected to
          if (connectedDevice && device.id === connectedDevice.id) return prev;
          return [...prev, device];
        });
      }
    });

    setTimeout(() => {
      manager.stopDeviceScan();
      setScanning(false);
    }, 8000);
  };

  const cancelConnection = async () => {
    if (!connectingId) return;
    try {
      await getManager()?.cancelDeviceConnection(connectingId);
      setConnectingId(null);
      Alert.alert("Cancelled", "Connection attempt aborted.");
    } catch (e) {
      setConnectingId(null);
    }
  };

  const handleDisconnect = async () => {
    if (!connectedDevice) return;
    try {
      await getManager()?.cancelDeviceConnection(connectedDevice.id);
      onDeviceConnected(null); // Clear state in settings
      onClose();
    } catch (e: any) {
      Alert.alert("Error", "Could not disconnect device.");
    }
  };

  const connect = async (device: Device) => {
    setConnectingId(device.id);
    try {
      getManager()?.stopDeviceScan();
      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();
      onDeviceConnected(connected);
      onClose();
    } catch (e: any) {
      if (e.message !== "Operation was cancelled") {
        Alert.alert("Connection Error", e.message);
      }
      setConnectingId(null);
    }
  };

  const renderHeader = () => (
    <View>
      {connectedDevice && (
        <View style={styles.connectedSection}>
          <Text style={styles.sectionTitle}>CURRENTLY CONNECTED</Text>
          <View style={styles.connectedCard}>
            <View>
              <Text style={styles.name}>
                {connectedDevice.name || "Stethoscope"}
              </Text>
              <Text style={styles.id}>{connectedDevice.id}</Text>
            </View>
            <TouchableOpacity
              style={styles.disconnectBtn}
              onPress={handleDisconnect}
            >
              <Text style={styles.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      <Text style={styles.sectionTitle}>AVAILABLE DEVICES</Text>
      {devices.length === 0 && !scanning && (
        <Text style={styles.emptyText}>
          No devices found. Pull down to rescan.
        </Text>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle}>Bluetooth Devices</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeArea}>
          <Text style={styles.closeBtnText}>Done</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={devices}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={styles.listPadding}
        refreshControl={
          <RefreshControl
            refreshing={scanning}
            onRefresh={startScan}
            tintColor="#007AFF"
          />
        }
        renderItem={({ item }) => {
          const isConnecting = connectingId === item.id;
          return (
            <View style={styles.itemCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name || "Unknown Device"}</Text>
                <Text style={styles.id}>{item.id}</Text>
              </View>

              {isConnecting ? (
                <View style={styles.connectingGroup}>
                  <ActivityIndicator size="small" color="#007AFF" />
                  <TouchableOpacity
                    onPress={cancelConnection}
                    style={styles.cancelLink}
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.connectBtn}
                  onPress={() => !connectingId && connect(item)}
                >
                  <Text style={styles.connectBtnText}>Connect</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F2F2F7" },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 20,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    alignItems: "center",
  },
  modalTitle: { fontSize: 20, fontWeight: "700" },
  closeArea: { padding: 5 },
  closeBtnText: { color: "#007AFF", fontSize: 17, fontWeight: "600" },
  listPadding: { paddingBottom: 40 },
  sectionTitle: {
    fontSize: 13,
    color: "#8E8E93",
    marginLeft: 20,
    marginTop: 25,
    marginBottom: 8,
    fontWeight: "600",
  },
  itemCard: {
    backgroundColor: "#fff",
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  connectedSection: { marginTop: 10 },
  connectedCard: {
    backgroundColor: "#fff",
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#34C759",
  },
  name: { fontSize: 17, fontWeight: "600", color: "#000" },
  id: { color: "#8E8E93", fontSize: 13, marginTop: 2 },
  connectBtn: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  connectBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  disconnectBtn: {
    backgroundColor: "#FFE5E5",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  disconnectText: { color: "#FF3B30", fontWeight: "600", fontSize: 14 },
  connectingGroup: { alignItems: "center" },
  cancelLink: { marginTop: 4 },
  cancelText: { color: "#FF3B30", fontSize: 12, fontWeight: "500" },
  emptyText: { textAlign: "center", marginTop: 30, color: "#8E8E93" },
});
