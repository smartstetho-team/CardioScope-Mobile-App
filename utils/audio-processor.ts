export const applyHeartFilter = (samples: Int16Array): Int16Array => {
  const output = new Int16Array(samples.length)

  // --- Coefficients from your ESP script (8000Hz) ---
  const notch = {
    b: [0.99217, -1.978665, 0.99217],
    a: [1.0, -1.978665, 0.984341],
  }
  const stage1 = {
    b: [0.002035, 0.004071, 0.002035],
    a: [1.0, -1.91617, 0.920516],
  }
  const stage2 = { b: [1.0, -2.0, 1.0], a: [1.0, -1.860136, 0.86407] }

  // Delay states for each biquad section [z-1, z-2]
  const zN = [0, 0],
    z1 = [0, 0],
    z2 = [0, 0]

  /** * Biquad Direct Form II Transposed implementation
   * Efficient for fixed-point hardware and mobile CPUs
   */
  const processBiquad = (x: number, coeffs: any, delay: number[]) => {
    const y = coeffs.b[0] * x + delay[0]
    delay[0] = coeffs.b[1] * x - coeffs.a[1] * y + delay[1]
    delay[1] = coeffs.b[2] * x - coeffs.a[2] * y
    return y
  }

  for (let i = 0; i < samples.length; i++) {
    // 1. Normalize input (-1.0 to 1.0)
    let sample = samples[i] / 32768.0

    // 2. Cascade processing
    sample = processBiquad(sample, notch, zN) // Remove 60Hz hum
    sample = processBiquad(sample, stage1, z1) // Bandpass Stage 1
    sample = processBiquad(sample, stage2, z2) // Bandpass Stage 2

    // 3. Digital Gain & Normalization
    // Use a high gain (e.g., 25.0) to make subtle S1/S2 sounds audible
    let boosted = sample * 25.0

    // Hard clipping protection
    if (boosted > 1.0) boosted = 1.0
    if (boosted < -1.0) boosted = -1.0

    output[i] = Math.round(boosted * 32767)
  }

  return output
}
