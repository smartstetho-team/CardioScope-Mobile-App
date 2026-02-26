import { Platform } from "react-native";

const isWeb = Platform.OS === "web";
let BlePlx: any = null;
let managerSingleton: any = null;

function loadBlePlx() {
  if (isWeb) return null;
  if (BlePlx) return BlePlx;
  try {
    // Runtime require prevents web bundler crashes
    BlePlx = require("react-native-ble-plx");
    return BlePlx;
  } catch (e) {
    return null;
  }
}

export function getManager() {
  if (isWeb) return null;
  if (managerSingleton) return managerSingleton;

  const mod = loadBlePlx();
  if (!mod?.BleManager) return null;

  try {
    managerSingleton = new mod.BleManager();
    return managerSingleton;
  } catch (e) {
    return null;
  }
}
