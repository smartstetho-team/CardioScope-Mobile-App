const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// Add 'onnx' and 'data' to the asset extensions array
config.resolver.assetExts.push('onnx', 'data')

module.exports = config
