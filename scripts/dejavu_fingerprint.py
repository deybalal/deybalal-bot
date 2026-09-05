#!/usr/bin/env python3
"""
dejavu_fingerprint.py

High-performance, storage-optimized audio fingerprinting engine based on the
Shazam / Dejavu algorithm.
- Decodes audio via FFmpeg
- Normalizes volume so quiet microphone recordings match studio recordings
- Generates STFT spectrogram
- Extracts landmark frequency peaks across calibrated logarithmic bands (~20-25 fps/sec)
- Generates 60-bit integer hashes for ultra-fast SQLite B-tree lookups and minimal DB footprint

Usage:
    python scripts/dejavu_fingerprint.py <audio_file_path> [--duration <seconds>]
"""

import sys
import os
import json
import subprocess
import hashlib
import numpy as np

SAMPLE_RATE = 44100
FFT_WINDOW_SIZE = 4096
HOP_SIZE = 2048  # 50% overlap

# Calibrated logarithmic frequency bands (bins up to ~5400Hz)
FREQ_BANDS = [
    (2, 12),    # ~21Hz - 129Hz (sub-bass / bass)
    (12, 25),   # ~129Hz - 269Hz (low-mid)
    (25, 50),   # ~269Hz - 538Hz (midrange)
    (50, 100),  # ~538Hz - 1076Hz (high-mid)
    (100, 200), # ~1076Hz - 2153Hz (treble)
    (200, 500)  # ~2153Hz - 5383Hz (presence)
]

TIME_NEIGHBORHOOD = 8   # ~0.37s sliding window for peak uniqueness
FAN_VALUE = 5           # pairs per landmark peak (Shazam standard)
MIN_HASH_TIME_DELTA = 1 # minimum frames between peaks
MAX_HASH_TIME_DELTA = 120 # maximum frames between peaks (~5.5s)

def read_audio_with_ffmpeg(file_path, duration_limit=None):
    """
    Decodes audio to 44100Hz 16-bit mono PCM using FFmpeg.
    Normalizes audio peak volume so quiet phone recordings match studio masters.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    command = ["ffmpeg", "-v", "error"]
    
    if duration_limit and duration_limit > 0:
        command.extend(["-t", str(duration_limit)])
        
    command.extend([
        "-i", file_path,
        "-ac", "1",
        "-ar", str(SAMPLE_RATE),
        "-f", "s16le",
        "-"
    ])

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    stdout, stderr = process.communicate()

    if process.returncode != 0:
        raise RuntimeError(f"FFmpeg decoding failed: {stderr.decode('utf-8', errors='replace')}")

    audio_data = np.frombuffer(stdout, dtype=np.int16)

    # Volume normalization: boost quiet microphone / phone recordings to standard level
    if len(audio_data) > 0:
        max_val = float(np.max(np.abs(audio_data)))
        if 0 < max_val < 24000:
            scale = 25000.0 / max_val
            audio_data = np.clip(audio_data.astype(np.float32) * scale, -32768, 32767).astype(np.int16)

    return audio_data

def compute_spectrogram(samples, fft_size=FFT_WINDOW_SIZE, hop_size=HOP_SIZE):
    """
    Computes magnitude spectrogram using Short-Time Fourier Transform (STFT).
    """
    if len(samples) < fft_size:
        padded = np.zeros(fft_size, dtype=np.int16)
        padded[:len(samples)] = samples
        samples = padded

    window = np.hanning(fft_size)
    num_frames = (len(samples) - fft_size) // hop_size + 1

    shape = (num_frames, fft_size)
    strides = (samples.strides[0] * hop_size, samples.strides[0])
    frames = np.lib.stride_tricks.as_strided(samples, shape=shape, strides=strides)

    spectrogram = np.abs(np.fft.rfft(frames * window, axis=-1))
    return spectrogram

def extract_landmark_peaks(spectrogram):
    """
    Extracts prominent acoustic peaks across calibrated frequency bands.
    Uses relative energy thresholds so quiet clips and loud tracks are treated equally.
    """
    num_frames = spectrogram.shape[0]
    peaks = []

    for f_low, f_high in FREQ_BANDS:
        if f_low >= spectrogram.shape[1]:
            continue
        actual_high = min(f_high, spectrogram.shape[1])
        band_spec = spectrogram[:, f_low:actual_high]
        if band_spec.shape[1] == 0:
            continue

        band_max_freq = np.argmax(band_spec, axis=1) + f_low
        band_max_val = np.max(band_spec, axis=1)

        # Adaptive threshold: top 40% of energy in band, minimum 1000
        threshold = max(1000.0, float(np.percentile(band_max_val, 60)))

        for t in range(num_frames):
            val = band_max_val[t]
            if val < threshold:
                continue
            t_start = max(0, t - TIME_NEIGHBORHOOD)
            t_end = min(num_frames, t + TIME_NEIGHBORHOOD + 1)
            if val == np.max(band_max_val[t_start:t_end]):
                peaks.append((t, int(band_max_freq[t])))

    peaks.sort(key=lambda p: (p[0], p[1]))
    return peaks

def generate_fingerprints(peaks, fan_value=FAN_VALUE):
    """
    Pairs landmark peaks into combinatorial hashes.
    Hash is a 60-bit integer (fits SQLite 64-bit integer, cuts storage by 50% and accelerates B-trees).
    Returns list of [hash_int, time_offset].
    """
    fingerprints = []
    num_peaks = len(peaks)

    for i in range(num_peaks):
        t1, f1 = peaks[i]
        for j in range(1, fan_value + 1):
            if i + j >= num_peaks:
                break
            t2, f2 = peaks[i + j]
            delta_t = t2 - t1

            if MIN_HASH_TIME_DELTA <= delta_t <= MAX_HASH_TIME_DELTA:
                raw_token = f"{f1}|{f2}|{delta_t}".encode("utf-8")
                # 15 hex chars -> 60-bit positive integer
                hash_int = int(hashlib.md5(raw_token).hexdigest()[:15], 16)
                fingerprints.append([hash_int, int(t1)])

    return fingerprints

def fingerprint_file(file_path, duration_limit=None):
    """
    Full pipeline: read audio -> compute spectrogram -> extract peaks -> generate fingerprints.
    """
    audio = read_audio_with_ffmpeg(file_path, duration_limit=duration_limit)
    spectrogram = compute_spectrogram(audio)
    peaks = extract_landmark_peaks(spectrogram)
    fps = generate_fingerprints(peaks)
    return fps

def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <audio_file_path> [--duration <seconds>]", file=sys.stderr)
        sys.exit(1)

    file_path = sys.argv[1]
    duration_limit = None

    if "--duration" in sys.argv:
        idx = sys.argv.index("--duration")
        if idx + 1 < len(sys.argv):
            try:
                duration_limit = float(sys.argv[idx + 1])
            except ValueError:
                pass

    try:
        fingerprints = fingerprint_file(file_path, duration_limit=duration_limit)
        print(json.dumps(fingerprints))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
