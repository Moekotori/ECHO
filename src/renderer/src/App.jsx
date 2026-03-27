import React, { useState, useRef, useEffect, useCallback } from 'react'
import { FolderHeart, Play, Pause, SkipForward, SkipBack, Download, Music, X, Square, Volume2, Shuffle, Repeat, Repeat1, FileAudio, Trash2, Mic2, ChevronLeft, Search, Settings, ToggleLeft, ToggleRight, Sliders, Info, Zap, Image, MessageSquare, Palette, Wand2, CheckCircle2 } from 'lucide-react'

const hexToRgbStr = (hex) => {
  let validHex = hex.replace('#', '')
  if (validHex.length === 3) validHex = validHex.split('').map(c => c + c).join('')
  const r = parseInt(validHex.substring(0, 2) || 'ff', 16)
  const g = parseInt(validHex.substring(2, 4) || 'ff', 16)
  const b = parseInt(validHex.substring(4, 6) || 'ff', 16)
  return `${r}, ${g}, ${b}`
}

const hslToHex = (h, s, l) => {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

const generateRandomPalette = () => {
  const H = Math.floor(Math.random() * 360);
  const S = 60 + Math.floor(Math.random() * 40); // 60-100% saturation
  const isDark = Math.random() > 0.5;

  const accent1 = hslToHex(H, S, 60);
  const accent2 = hslToHex((H + 40) % 360, S, 65);
  const accent3 = hslToHex((H + 80) % 360, S, 70);

  if (isDark) {
    return {
      bgColor: hslToHex(H, 30, 8),
      glassColor: hslToHex(H, 20, 12),
      textMain: hslToHex(H, 10, 90),
      textSoft: hslToHex(H, 20, 60),
      accent1, accent2, accent3
    };
  } else {
    return {
      bgColor: hslToHex(H, 20, 96),
      glassColor: '#ffffff',
      textMain: hslToHex(H, 40, 20),
      textSoft: hslToHex(H, 30, 50),
      accent1, accent2, accent3
    };
  }
};

const PRESET_THEMES = {
  sakura: {
    name: 'Sakura Blossom',
    colors: { bgColor: '#f7f3f5', accent1: '#f7aab5', accent2: '#a3d2e3', accent3: '#bbf0d8', textMain: '#5c4349', textSoft: '#9a888c', glassColor: '#ffffff' }
  },
  midnight: {
    name: 'Midnight Echo',
    colors: { bgColor: '#0f172a', accent1: '#818cf8', accent2: '#c084fc', accent3: '#38bdf8', textMain: '#f8fafc', textSoft: '#94a3b8', glassColor: '#1e293b' }
  },
  matcha: {
    name: 'Matcha Latte',
    colors: { bgColor: '#f4fbf4', accent1: '#86efac', accent2: '#fde047', accent3: '#93c5fd', textMain: '#14532d', textSoft: '#4ade80', glassColor: '#ffffff' }
  },
  sunset: {
    name: 'Sunset Glow',
    colors: { bgColor: '#fff1f2', accent1: '#fb7185', accent2: '#fbbf24', accent3: '#a78bfa', textMain: '#881337', textSoft: '#fda4af', glassColor: '#ffffff' }
  }
}

export default function App() {
  const [playlist, setPlaylist] = useState(() => {
    const saved = localStorage.getItem('nc_playlist')
    return saved ? JSON.parse(saved) : []
  })
  const [playMode, setPlayMode] = useState(() => {
    return localStorage.getItem('nc_playmode') || 'loop'
  })
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [coverUrl, setCoverUrl] = useState(null)
  
  const [playbackRate, setPlaybackRate] = useState(1.25)
  const [volume, setVolume] = useState(1.0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isExporting, setIsExporting] = useState(false)

  // Lyrics States
  const [showLyrics, setShowLyrics] = useState(false)
  const [lyrics, setLyrics] = useState([])
  const [activeLyricIndex, setActiveLyricIndex] = useState(-1)
  const [metadata, setMetadata] = useState({ title: '', artist: '' })
  const [searchQuery, setSearchQuery] = useState('')
  const [technicalInfo, setTechnicalInfo] = useState({ 
    sampleRate: null, 
    originalBpm: null, 
    channels: null,
    bitrate: null,
    codec: null
  })
  const [isConverting, setIsConverting] = useState(false)
  const [conversionMsg, setConversionMsg] = useState('')

  // Hi-Fi & Navigation States
  const [view, setView] = useState('player') // 'player', 'lyrics', 'settings'
  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem('nc_config')
    return saved ? JSON.parse(saved) : {
      showVisualizer: true,
      useEQ: true,
      eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      visualizerStyle: 'bars',
      showDiscordRPC: true,
      customBgPath: null,
      customBgOpacity: 1.0,
      uiBgOpacity: 0.6,
      uiBlur: 20,
      theme: 'sakura',
      customColors: PRESET_THEMES.sakura.colors
    }
  })

  useEffect(() => {
    localStorage.setItem('nc_config', JSON.stringify(config))
    
    // Update global CSS variables for UI Themes and Glass
    const root = document.documentElement
    
    let activeTheme = PRESET_THEMES.sakura.colors
    if (config.theme === 'custom' && config.customColors) {
      activeTheme = config.customColors
    } else if (PRESET_THEMES[config.theme]) {
      activeTheme = PRESET_THEMES[config.theme].colors
    }

    root.style.setProperty('--bg-color', activeTheme.bgColor)
    root.style.setProperty('--accent-pink', activeTheme.accent1)
    root.style.setProperty('--accent-blue', activeTheme.accent2)
    root.style.setProperty('--accent-mint', activeTheme.accent3)
    root.style.setProperty('--text-main', activeTheme.textMain)
    root.style.setProperty('--text-soft', activeTheme.textSoft)

    const uiOpa = config.uiBgOpacity !== undefined ? config.uiBgOpacity : 0.6
    const uiBlur = config.uiBlur !== undefined ? config.uiBlur : 20
    const glassRgbStr = hexToRgbStr(activeTheme.glassColor || '#ffffff')
    
    root.style.setProperty('--glass-bg', `rgba(${glassRgbStr}, ${uiOpa})`)
    root.style.setProperty('--glass-border', `rgba(${glassRgbStr}, ${Math.min(uiOpa + 0.2, 1)})`)
    root.style.setProperty('--glass-blur', `${uiBlur}px`)

    const isDark = activeTheme.glassColor !== '#ffffff' && parseInt(glassRgbStr.split(',')[0]) < 100
    root.style.setProperty('--shadow-color', isDark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(200, 180, 190, 0.2)')
  }, [config])

  const audioRef = useRef(new Audio())
  const playbackRateRef = useRef(playbackRate)
  
  // Web Audio Refs
  const audioContext = useRef(null)
  const sourceNode = useRef(null)
  const analyserNode = useRef(null)
  const gainNode = useRef(null)
  const eqFilters = useRef([])
  const canvasRef = useRef(null)
  const animationRef = useRef(null)

  // Initialize Web Audio
  const initAudioContext = useCallback(() => {
    if (audioContext.current) return

    const Context = window.AudioContext || window.webkitAudioContext
    const ctx = new Context()
    audioContext.current = ctx

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyserNode.current = analyser

    const gain = ctx.createGain()
    gainNode.current = gain

    // Create 10-band EQ
    const frequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    const filters = frequencies.map((freq) => {
      const filter = ctx.createBiquadFilter()
      filter.type = 'peaking'
      filter.frequency.value = freq
      filter.Q.value = 1.4
      filter.gain.value = 0
      return filter
    })
    eqFilters.current = filters

    const source = ctx.createMediaElementSource(audioRef.current)
    sourceNode.current = source

    // Connect chain: Source -> EQ... -> Analyser -> Gain -> Destination
    let lastNode = source
    if (config.useEQ) {
      filters.forEach((f, i) => {
        f.gain.value = config.eqGains[i]
        lastNode.connect(f)
        lastNode = f
      })
    }
    lastNode.connect(analyser)
    analyser.connect(gain)
    gain.connect(ctx.destination)
  }, [config.useEQ, config.eqGains])

  useEffect(() => {
    // Update EQ Gains in real-time
    if (eqFilters.current.length > 0) {
      eqFilters.current.forEach((filter, i) => {
        filter.gain.value = config.useEQ ? config.eqGains[i] : 0
      })
    }
  }, [config.eqGains, config.useEQ])

  // Persist playlist and mode
  useEffect(() => {
    localStorage.setItem('nc_playlist', JSON.stringify(playlist))
  }, [playlist])

  useEffect(() => {
    localStorage.setItem('nc_playmode', playMode)
  }, [playMode])

  // Update playback speed whenever it changes
  useEffect(() => {
    playbackRateRef.current = playbackRate
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate
    }
  }, [playbackRate])

  // Update volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume
    }
  }, [volume])

  // Audio setup
  useEffect(() => {
    const audio = audioRef.current
    audio.preservesPitch = false // THE MAGIC: disabling pitch preservation!
    
    const setAudioData = () => {
      setDuration(audio.duration)
      audio.playbackRate = playbackRateRef.current // Preserves NC speed naturally!
    }
    const updateTime = () => {
      const time = audio.currentTime
      setCurrentTime(time)
      
      // Update active lyric index
      if (lyricsRef.current.length > 0) {
        let index = -1
        for (let i = 0; i < lyricsRef.current.length; i++) {
          if (time >= lyricsRef.current[i].time) {
            index = i
          } else {
            break
          }
        }
        setActiveLyricIndex(index)
      }
    }
    const onEnded = () => {
      if (playMode === 'single') {
        const audio = audioRef.current
        audio.currentTime = 0
        audio.play().catch(console.error)
      } else {
        handleNext()
      }
    }

    audio.addEventListener('loadeddata', setAudioData)
    audio.addEventListener('timeupdate', updateTime)
    audio.addEventListener('ended', onEnded)

    return () => {
      audio.removeEventListener('loadeddata', setAudioData)
      audio.removeEventListener('timeupdate', updateTime)
      audio.removeEventListener('ended', onEnded)
    }
  }, [playlist, currentIndex, playMode])
  // Play track logic
  useEffect(() => {
    if (currentIndex >= 0 && playlist[currentIndex]) {
      const track = playlist[currentIndex]
      // Use local file path
      audioRef.current.src = `file://${track.path}`
      audioRef.current.load()
      if (isPlaying) {
        audioRef.current.play().catch(console.error)
      }

      // Load cover art & Metadata & Lyrics
      loadTrackData(track.path)
    }
  }, [currentIndex])

  useEffect(() => {
    if (isPlaying) {
      initAudioContext()
      if (audioContext.current?.state === 'suspended') {
        audioContext.current.resume()
      }
      audioRef.current.play().catch(console.error)
    } else {
      audioRef.current.pause()
    }
  }, [isPlaying, initAudioContext])

  const lyricsRef = useRef([])
  const scrollAreaRef = useRef(null)
  
  useEffect(() => {
    lyricsRef.current = lyrics
  }, [lyrics])

  useEffect(() => {
    if (showLyrics && activeLyricIndex !== -1 && scrollAreaRef.current) {
      const activeElement = scrollAreaRef.current.querySelector('.lyric-line.active')
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [activeLyricIndex, showLyrics])

  const parseLRC = (lrcString) => {
    const lines = lrcString.split('\n')
    const parsed = []
    const timeReg = /\[(\d{2}):(\d{2})(\.|\:)(\d{2,3})\]/
    let lastTime = -1
    
    lines.forEach(line => {
      const match = timeReg.exec(line)
      if (match) {
        const minutes = parseInt(match[1])
        const seconds = parseInt(match[2])
        const ms = parseInt(match[4])
        const time = minutes * 60 + seconds + (ms / (match[4].length === 3 ? 1000 : 100))
        
        // Skip duplicate timestamps (usually translation lines)
        if (time === lastTime) return
        
        const text = line.replace(timeReg, '').trim()
        if (text) {
          parsed.push({ time, text })
          lastTime = time
        }
      }
    })
    return parsed.sort((a, b) => a.time - b.time)
  }

  const fetchLyrics = async (filePath, title, artist) => {
    setLyrics([])
    setActiveLyricIndex(-1)
    
    // 1. Try local LRC
    try {
      const localLrc = await window.api.readLyricsHandler(filePath)
      if (localLrc) {
        setLyrics(parseLRC(localLrc))
        return
      }
    } catch (e) { console.error("Local LRC error", e) }

    // 2. Try LRCLIB API
    if (title) {
      try {
        const query = encodeURIComponent(`${title} ${artist || ''}`)
        const response = await fetch(`https://lrclib.net/api/search?q=${query}`)
        const data = await response.json()
        if (data && data.length > 0) {
          // Find best match or just take first
          const best = data[0]
          if (best.syncedLyrics) {
            setLyrics(parseLRC(best.syncedLyrics))
            return
          }
        }
      } catch (e) { console.error("LRCLIB error", e) }
    }
    
    setLyrics([{ time: 0, text: "No lyrics found" }])
  }

  const detectBPM = (buffer) => {
    const data = buffer.getChannelData(0)
    const sampleRate = buffer.sampleRate
    
    // 1. Calculate an envelope (moving average of absolute values)
    // We'll use a larger step to speed up processing
    const step = 100 
    const envelope = []
    for (let i = 0; i < data.length; i += step) {
      let sum = 0
      for (let j = 0; j < step && i + j < data.length; j++) {
        sum += Math.abs(data[i + j])
      }
      envelope.push(sum / step)
    }

    // 2. Normalization
    const max = Math.max(...envelope)
    if (max < 0.01) return null 
    const normalized = envelope.map(v => v / max)

    // 3. Peak Detection (Onset Detection)
    // We look for points where the envelope is high and increasing
    const peaks = []
    const threshold = 0.3
    const minDistance = (sampleRate / step) * 0.3 // ~200 BPM max limit
    
    for (let i = 1; i < normalized.length - 1; i++) {
      if (normalized[i] > threshold && 
          normalized[i] > normalized[i - 1] && 
          normalized[i] > normalized[i + 1]) {
        peaks.push(i)
        i += Math.floor(minDistance)
      }
    }

    if (peaks.length < 5) return null

    // 4. Interval Histogram
    const intervals = []
    for (let i = 1; i < peaks.length; i++) {
      const interval = peaks[i] - peaks[i - 1]
      const bpm = Math.round(60 / ((interval * step) / sampleRate))
      if (bpm >= 60 && bpm <= 200) {
        intervals.push(bpm)
      }
    }

    if (intervals.length === 0) return null

    // 5. Find the most frequent BPM range (the mode)
    const counts = {}
    let maxCount = 0
    let bestBpm = null
    
    intervals.forEach(bpm => {
      // Group similar BPMs into buckets of 2
      const bucket = Math.round(bpm / 2) * 2 
      counts[bucket] = (counts[bucket] || 0) + 1
      if (counts[bucket] > maxCount) {
        maxCount = counts[bucket]
        bestBpm = bucket
      }
    })

    return bestBpm
  }

  const loadTrackData = async (filePath) => {
    setCoverUrl(null)
    setMetadata({ title: '', artist: '' })
    setTechnicalInfo({ sampleRate: null, originalBpm: null, bitrate: null, codec: null })
    
    try {
      // 1. Get Extended Metadata from Main Process (Music-Metadata)
      const data = await window.api.getExtendedMetadataHandler(filePath)
      
      if (data.success) {
        const { technical, common } = data
        setMetadata({ title: common.title, artist: common.artist })
        setTechnicalInfo(prev => ({
          ...prev,
          sampleRate: technical.sampleRate,
          bitrate: technical.bitrate,
          channels: technical.channels,
          codec: technical.codec,
          originalBpm: null // Will be updated by detection or tags below
        }))
        
        if (common.cover) {
          setCoverUrl(common.cover)
        } else {
          fetchCloudCover(common.title, common.artist)
        }

        fetchLyrics(filePath, common.title, common.artist)
      } else {
        // Fallback for failed extraction
        const title = filePath.split('\\').pop().split('/').pop().replace(/\.[^/.]+$/, "")
        setMetadata({ title, artist: "Unknown Artist" })
        fetchCloudCover(title, "")
        fetchLyrics(filePath, title, "")
      }

      // 2. BPM Detection (Keep as is, but use less memory)
      const arrayBuffer = await window.api.readBufferHandler(filePath)
      if (arrayBuffer) {
        try {
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
          const slice = arrayBuffer.slice(0, 1024 * 1024 * 10) 
          const decodedBuffer = await audioCtx.decodeAudioData(slice.buffer || slice)
          const detectedBpm = detectBPM(decodedBuffer)
          setTechnicalInfo(prev => ({ ...prev, originalBpm: detectedBpm }))
        } catch(e) { console.error("BPM detection error:", e) }
      }

    } catch (e) {
      console.error("Track data extraction error:", e)
    }
  }

  const fetchCloudCover = async (title, artist) => {
    if (!title) return
    try {
      const query = encodeURIComponent(`${title} ${artist || ''}`)
      const response = await fetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=1`)
      const data = await response.json()
      if (data && data.results && data.results.length > 0) {
        const artwork = data.results[0].artworkUrl100
        // Get high-res version: 1000x1000
        const highRes = artwork.replace("100x100bb.jpg", "1000x1000bb.jpg")
        setCoverUrl(highRes)
      }
    } catch (e) {
      console.error("Cloud cover fetch error:", e)
    }
  }

  const processFiles = async (files) => {
    setIsConverting(true)
    const processed = []
    const existingPaths = new Set(playlist.map(p => p.path))

    for (const file of files) {
      if (existingPaths.has(file.path)) continue

      if (file.path.toLowerCase().endsWith('.ncm')) {
        setConversionMsg(`Decrypting: ${file.name}...`)
        const result = await window.api.convertNcmHandler(file.path)
        if (result.success) {
          processed.push({
            name: result.name,
            path: result.path
          })
        } else {
          console.error("Failed to convert:", file.path, result.error)
        }
      } else {
        processed.push(file)
      }
    }

    if (processed.length > 0) {
      setPlaylist(prev => [...prev, ...processed])
      if (currentIndex === -1) setCurrentIndex(0)
    }
    setIsConverting(false)
    setConversionMsg('')
  }

  const handleImport = async () => {
    const folders = await window.api.openDirectoryHandler()
    if (folders && folders.length > 0) {
      const audioFiles = await window.api.readDirectoryHandler(folders[0])
      if (audioFiles.length > 0) {
        await processFiles(audioFiles)
      }
    }
  }

  const handleImportFile = async () => {
    const files = await window.api.openFileHandler()
    if (files && files.length > 0) {
      await processFiles(files)
    }
  }

  const handleClearPlaylist = () => {
    setPlaylist([])
    setCurrentIndex(-1)
    setIsPlaying(false)
    setDuration(0)
    setCurrentTime(0)
    setCoverUrl(null)
    if (audioRef.current) audioRef.current.src = ''
  }

  const togglePlay = () => {
    if (currentIndex === -1 && playlist.length > 0) {
      setCurrentIndex(0)
    }
    setIsPlaying(!isPlaying)
  }

  const handleNext = () => {
    if (playlist.length > 0) {
      if (playMode === 'shuffle') {
        let nextIdx = Math.floor(Math.random() * playlist.length)
        if (nextIdx === currentIndex && playlist.length > 1) {
          nextIdx = (nextIdx + 1) % playlist.length
        }
        setCurrentIndex(nextIdx)
      } else {
        setCurrentIndex((prev) => (prev + 1) % playlist.length)
      }
      setIsPlaying(true)
    }
  }

  const handlePrev = () => {
    if (playlist.length > 0) {
      if (playMode === 'shuffle') {
        let prevIdx = Math.floor(Math.random() * playlist.length)
        if (prevIdx === currentIndex && playlist.length > 1) {
          prevIdx = (prevIdx - 1 + playlist.length) % playlist.length
        }
        setCurrentIndex(prevIdx)
      } else {
        setCurrentIndex((prev) => (prev - 1 + playlist.length) % playlist.length)
      }
      setIsPlaying(true)
    }
  }

  const formatTime = (time) => {
    if (isNaN(time)) return "0:00"
    const min = Math.floor(time / 60)
    const sec = Math.floor(time % 60)
    return `${min}:${sec < 10 ? '0' : ''}${sec}`
  }

  const handleSeek = (e) => {
    const val = e.target.value
    audioRef.current.currentTime = val
    setCurrentTime(val)
  }

  const handleExport = async () => {
    if (currentIndex === -1 || !playlist[currentIndex]) return
    setIsExporting(true)
    try {
      const track = playlist[currentIndex]
      const arrayBuffer = await window.api.readBufferHandler(track.path)
      
      // Offline Audio Processing
      const audioCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, 1, 44100)
      const audioData = await audioCtx.decodeAudioData(arrayBuffer.buffer || arrayBuffer)
      
      const rate = playbackRate
      const duration = audioData.duration / rate
      const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
        audioData.numberOfChannels,
        audioCtx.sampleRate * duration,
        audioCtx.sampleRate
      )

      const source = offlineCtx.createBufferSource()
      source.buffer = audioData
      source.playbackRate.value = rate
      
      source.connect(offlineCtx.destination)
      source.start(0)

      const renderedBuffer = await offlineCtx.startRendering()
      
      // Encode to WAV (simple implementation)
      const wavBuffer = audioBufferToWav(renderedBuffer)
      
      // Save it via IPC
      const result = await window.api.saveExportHandler(
        new Uint8Array(wavBuffer).buffer,
        `Nightcore_${track.name.replace('.mp3', '.wav')}`
      )
      
      if (result.success) {
        alert("Export successful!")
      }
    } catch (e) {
      console.error(e)
      alert("Failed to export: " + e.message)
    }
    setIsExporting(false)
  }

  // AudioBuffer to pure PCM WAV conversion helper
  const audioBufferToWav = (buffer) => {
    const numOfChan = buffer.numberOfChannels
    const length = buffer.length * numOfChan * 2 + 44
    const bufferArray = new ArrayBuffer(length)
    const view = new DataView(bufferArray)
    const channels = []
    let sample = 0
    let offset = 0
    let pos = 0

    const setUint16 = (data) => {
      view.setUint16(pos, data, true)
      pos += 2
    }
    const setUint32 = (data) => {
      view.setUint32(pos, data, true)
      pos += 4
    }

    setUint32(0x46464952) // "RIFF"
    setUint32(length - 8)
    setUint32(0x45564157) // "WAVE"
    setUint32(0x20746d66) // "fmt " chunk
    setUint32(16) // length = 16
    setUint16(1) // PCM (uncompressed)
    setUint16(numOfChan)
    setUint32(buffer.sampleRate)
    setUint32(buffer.sampleRate * 2 * numOfChan) // avg. bytes/sec
    setUint16(numOfChan * 2) // block-align
    setUint16(16) // 16-bit
    setUint32(0x61746164) // "data" - chunk
    setUint32(length - pos - 4) // chunk length

    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i))
    }

    while (pos < length) {
      for (let i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][offset]))
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0
        view.setInt16(pos, sample, true)
        pos += 2
      }
      offset++
    }
    return bufferArray
  }

  const currentTrack = currentIndex >= 0 ? playlist[currentIndex] : null

  // Discord Rich Presence
  useEffect(() => {
    if (!window.api?.setDiscordActivity) return
    
    if (!config.showDiscordRPC) {
      window.api.clearDiscordActivity()
      return
    }

    if (currentTrack && metadata.title) {
      const now = Math.floor(Date.now() / 1000)
      const durationSec = Math.round((duration || 0) / playbackRate)
      const elapsed = Math.round((currentTime || 0) / playbackRate)
      
      const speedStr = playbackRate !== 1.0 ? ` | ${playbackRate.toFixed(2)}x` : ''

      let endTimestamp = null
      if (isPlaying && durationSec > 0 && !isNaN(durationSec)) {
        endTimestamp = now - elapsed + durationSec
      }

      window.api.setDiscordActivity({
        title: metadata.title,
        artist: `${metadata.artist || 'Unknown Artist'}${speedStr}`,
        isPlaying,
        startTimestamp: isPlaying ? now - elapsed : null,
        endTimestamp: endTimestamp,
        coverUrl: coverUrl
      })
    } else {
      window.api.clearDiscordActivity()
    }
  }, [metadata.title, metadata.artist, isPlaying, config.showDiscordRPC, playbackRate, currentTime, duration, currentTrack, coverUrl])

  // Visualizer Animation
  useEffect(() => {
    if (!config.showVisualizer || !isPlaying || view === 'settings') {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      return
    }

    const render = () => {
      if (!canvasRef.current || !analyserNode.current) return
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')
      const bufferLength = analyserNode.current.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)
      
      analyserNode.current.getByteFrequencyData(dataArray)
      
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      
      const barWidth = (canvas.width / bufferLength) * 2.5
      let barHeight
      let x = 0

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height
        
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0)
        gradient.addColorStop(0, 'rgba(247, 170, 181, 0.2)')
        gradient.addColorStop(0.5, 'rgba(247, 170, 181, 0.6)')
        gradient.addColorStop(1, 'rgba(247, 170, 181, 1)')
        
        ctx.fillStyle = gradient
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight)
        
        x += barWidth
      }
      
      animationRef.current = requestAnimationFrame(render)
    }

    render()
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [config.showVisualizer, isPlaying, view])

  return (
    <div className="app-container">
      {config.customBgPath && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, width: '100vw', height: '100vh',
          backgroundImage: `url("${config.customBgPath}")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: config.customBgOpacity,
          zIndex: -1,
          pointerEvents: 'none'
        }} />
      )}
      {isConverting && (
        <div className="conversion-overlay">
          <div className="loader-box glass-panel">
            <div className="spinner"></div>
            <p>{conversionMsg}</p>
          </div>
        </div>
      )}
      <div className="titlebar">
        <span>Echoes Studio</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
          <button
            className="no-drag"
            onClick={() => setView(view === 'settings' ? 'player' : 'settings')}
            style={{
              background: 'none', border: 'none', color: view === 'settings' ? 'var(--accent-pink)' : 'inherit', cursor: 'pointer',
              padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--accent-pink)'; e.currentTarget.style.transform = 'rotate(45deg)'; }}
            onMouseOut={(e) => { e.currentTarget.style.color = view === 'settings' ? 'var(--accent-pink)' : 'inherit'; e.currentTarget.style.transform = 'rotate(0deg)'; }}
          >
            <Settings size={18} />
          </button>
          <button
            className="no-drag"
            onClick={() => window.api.maximizeAppHandler()} 
            style={{
              background: 'none', border: 'none', color: 'inherit', cursor: 'pointer',
              padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--text-main)'; e.currentTarget.style.background = 'rgba(255,255,255,0.4)'; e.currentTarget.style.borderRadius = '50%'; }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'inherit'; e.currentTarget.style.background = 'none'; e.currentTarget.style.borderRadius = '0'; }}
          >
            <Square size={14} />
          </button>
          <button 
            className="no-drag" 
            onClick={() => window.api.closeAppHandler()} 
            style={{
              background: 'none', border: 'none', color: 'inherit', cursor: 'pointer',
              padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'white'; e.currentTarget.style.background = 'var(--accent-pink)'; e.currentTarget.style.borderRadius = '50%'; }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'inherit'; e.currentTarget.style.background = 'none'; e.currentTarget.style.borderRadius = '0'; }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className={`sidebar glass-panel no-drag ${(showLyrics || view === 'settings') ? 'hidden' : ''}`}>
        <div style={{display: 'flex', gap: '8px', zIndex: 10}}>
          <button className="import-btn" style={{flex: 1, padding: '10px'}} onClick={handleImport} title="Import Folder">
            <FolderHeart size={18} />
          </button>
          <button className="import-btn" style={{flex: 1, padding: '10px'}} onClick={handleImportFile} title="Import Files">
            <FileAudio size={18} />
          </button>
          <button className="import-btn" style={{padding: '10px', background: 'rgba(255,255,255,0.4)', color: 'var(--text-main)', boxShadow: 'none'}} onClick={handleClearPlaylist} title="Clear Playlist">
            <Trash2 size={18} />
          </button>
        </div>
        
        <div className="search-container no-drag">
          <Search size={16} className="search-icon" />
          <input 
            type="text" 
            placeholder="Search tracks..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="playlist">
          {playlist.length === 0 && (
            <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '20px', fontSize: 14 }}>
              No tracks yet. <br /> Import a folder to start!
            </div>
          )}
          {playlist
            .map((track, originalIdx) => ({ ...track, originalIdx }))
            .filter(track => track.name.toLowerCase().includes(searchQuery.toLowerCase()))
            .map((track) => (
              <div 
                key={track.originalIdx} 
                className={`track-item ${track.originalIdx === currentIndex ? 'active' : ''}`}
                onClick={() => {
                  setCurrentIndex(track.originalIdx)
                  setIsPlaying(true)
                }}
              >
                <Music size={16} style={{marginRight: 8, opacity: 0.5}} />
                <div className="track-name" title={track.name}>{track.name}</div>
              </div>
            ))}
        </div>
      </div>

      <div className={`main-player glass-panel no-drag ${showLyrics ? 'lyrics-mode' : ''} ${view === 'settings' ? 'hidden' : ''}`}>
        {showLyrics ? (
          <div className="lyrics-view-container">
            <button className="back-btn" onClick={() => setShowLyrics(false)}>
              <ChevronLeft size={32} />
            </button>
            
            <div className="lyrics-header">
              <div className="mini-cover">
                {coverUrl ? <img src={coverUrl} alt="" /> : <Music />}
              </div>
              <div className="lyrics-meta">
                <h2>{metadata.title}</h2>
                <p>{metadata.artist}</p>
                <div className="technical-info-mini">
                  {technicalInfo.codec && <span className="mini-pill">{technicalInfo.codec.toUpperCase()}</span>}
                  {technicalInfo.bitrate && <span className="mini-pill">{Math.round(technicalInfo.bitrate / 1000)}KBPS</span>}
                  {technicalInfo.sampleRate && <span className="mini-pill">{technicalInfo.sampleRate / 1000}KHZ</span>}
                  {technicalInfo.channels && <span className="mini-pill">{technicalInfo.channels > 1 ? 'STEREO' : 'MONO'}</span>}
                  {technicalInfo.originalBpm && (
                    <span className="mini-pill bpm-pill-mini">
                      {technicalInfo.originalBpm} BPM → NC: {Math.round(technicalInfo.originalBpm * playbackRate)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="lyrics-scroll-area" ref={scrollAreaRef}>
              {lyrics.map((line, idx) => (
                <div 
                  key={idx} 
                  className={`lyric-line ${idx === activeLyricIndex ? 'active' : ''} ${idx < activeLyricIndex ? 'past' : ''}`}
                  onClick={() => audioRef.current.currentTime = line.time}
                >
                  {line.text}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="cover-wrapper">
              {coverUrl ? (
                <img 
                  src={coverUrl} 
                  draggable={false}
                  className={`cover-image ${isPlaying ? 'playing' : ''}`} 
                  alt="Cover Art" 
                />
              ) : (
                <div className="no-cover">
                  <Music size={64} style={{ opacity: 0.3 }} />
                </div>
              )}
            </div>

            <div className="track-info">
              <h1>{metadata.title || (currentTrack ? currentTrack.name.replace(/\.[^/.]+$/, "") : "Select a track")}</h1>
              <p className="artist-text">{metadata.artist || (currentTrack ? "Nightcore Mode" : "...")}</p>
              
              <div className="tech-pills-container">
                {technicalInfo.codec && (
                  <div className="tech-pill codec-pill">
                    {technicalInfo.codec.toUpperCase()}
                  </div>
                )}
                {technicalInfo.bitrate && (
                  <div className="tech-pill">
                    {Math.round(technicalInfo.bitrate / 1000)}kbps
                  </div>
                )}
                {technicalInfo.sampleRate && (
                  <div className={`tech-pill ${technicalInfo.sampleRate > 44100 || technicalInfo.bitrate > 500000 ? 'lossless-glow' : ''}`}>
                    {(technicalInfo.sampleRate > 44100 || technicalInfo.bitrate > 500000) && <Zap size={14} style={{marginRight: 4}} />}
                    {technicalInfo.sampleRate / 1000}KHZ
                  </div>
                )}
                {technicalInfo.channels && (
                  <div className="tech-pill">
                    {technicalInfo.channels > 1 ? 'STEREO' : 'MONO'}
                  </div>
                )}
                {technicalInfo.originalBpm && (
                  <div className="tech-pill bpm-pill">
                    <span className="bpm-orig">{technicalInfo.originalBpm} BPM</span>
                    <span className="bpm-arrow">→</span>
                    <span className="bpm-nc">{Math.round(technicalInfo.originalBpm * playbackRate)}</span>
                  </div>
                )}
              </div>
            </div>

            {config.showVisualizer && (
              <canvas 
                ref={canvasRef} 
                className="visualizer-canvas"
                width={400} 
                height={100}
              />
            )}
          </>
        )}

        <div className="controls-container">
          <div className="progress-area">
            <input 
              type="range" 
              min={0} 
              max={duration || 0} 
              value={currentTime} 
              onChange={handleSeek}
              style={{ padding: 0 }}
            />
            <div className="time-info">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <div className="buttons">
            <button className="btn" style={{width: 40, height: 40}} onClick={() => setPlayMode(playMode === 'shuffle' ? 'loop' : 'shuffle')}>
              <Shuffle size={18} color={playMode === 'shuffle' ? 'var(--accent-pink)' : 'inherit'} />
            </button>
            <button className="btn" onClick={handlePrev}><SkipBack size={24} /></button>
            <button className="btn play-btn" onClick={togglePlay}>
              {isPlaying ? <Pause size={32} /> : <Play size={32} style={{ marginLeft: 4 }} />}
            </button>
            <button className="btn" onClick={handleNext}><SkipForward size={24} /></button>
            <button className="btn" style={{width: 40, height: 40}} onClick={() => setPlayMode(playMode === 'single' ? 'loop' : 'single')}>
              {playMode === 'single' ? <Repeat1 size={18} color="var(--accent-pink)" /> : <Repeat size={18} color={playMode === 'loop' ? 'var(--accent-pink)' : 'inherit'} />}
            </button>
            <button className={`btn lyrics-toggle ${showLyrics ? 'active' : ''}`} onClick={() => setShowLyrics(!showLyrics)}>
              <Mic2 size={18} />
            </button>
          </div>

          <div className="nightcore-controls">
            <div className="nc-header">
              <span>Engine Speed</span>
              <span className="nc-badge">{playbackRate.toFixed(2)}x</span>
            </div>
            <div className="slider-wrapper" style={{marginBottom: 8}}>
              <span style={{fontSize: 12, opacity: 0.5, fontWeight: 'bold'}}>1.0</span>
              <input 
                type="range" 
                min={1.0} 
                max={2.0} 
                step={0.05} 
                value={playbackRate} 
                onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
              />
              <span style={{fontSize: 12, opacity: 0.5, fontWeight: 'bold'}}>2.0</span>
            </div>
            
            <div className="nc-header">
              <span>Volume</span>
              <span className="nc-badge">{Math.round(volume * 100)}%</span>
            </div>
            <div className="slider-wrapper">
              <Volume2 size={16} style={{opacity: 0.5}} />
              <input 
                type="range" 
                min={0.0} 
                max={1.0} 
                step={0.01} 
                value={volume} 
                onChange={(e) => setVolume(parseFloat(e.target.value))}
              />
            </div>

            <button 
              className="export-btn" 
              style={{marginTop: 12}}
              onClick={handleExport} 
              disabled={isExporting || !currentTrack}
            >
              <Download size={16} />
              {isExporting ? "Rendering Audio..." : "Render & Export Audio (.wav)"}
            </button>
          </div>
        </div>
      </div>
      {view === 'settings' && (
        <div className="settings-page glass-panel no-drag">
          <div className="settings-header">
            <button className="back-view-btn" onClick={() => setView('player')}>
              <ChevronLeft size={32} />
            </button>
            <h1>Audio Studio Settings</h1>
          </div>

          <div className="settings-content">
            <section className="settings-section">
              <div className="section-title">
                <Zap size={20} />
                <h2>Engine Mastery</h2>
              </div>
              <div className="setting-row">
                <div className="setting-info">
                  <h3>Real-time Spectrum visualizer</h3>
                  <p>Display audio frequency analytics on the main player.</p>
                </div>
                <button 
                  className={`toggle-btn ${config.showVisualizer ? 'active' : ''}`}
                  onClick={() => setConfig(prev => ({ ...prev, showVisualizer: !prev.showVisualizer }))}
                >
                  {config.showVisualizer ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                </button>
              </div>
              
              <div className="setting-row">
                <div className="setting-info">
                  <h3>Master Equalizer (10-Band)</h3>
                  <p>Enable precise frequency control for high-fidelity output.</p>
                </div>
                <button 
                  className={`toggle-btn ${config.useEQ ? 'active' : ''}`}
                  onClick={() => setConfig(prev => ({ ...prev, useEQ: !prev.useEQ }))}
                >
                  {config.useEQ ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                </button>
              </div>
            </section>

            <section className={`settings-section eq-section ${!config.useEQ ? 'disabled' : ''}`}>
              <div className="section-title">
                <Sliders size={20} />
                <h2>Precision EQ</h2>
              </div>
              <div className="eq-container">
                {[31, 62, 125, 250, 500, '1k', '2k', '4k', '8k', '16k'].map((label, i) => (
                  <div key={label} className="eq-band">
                    <div className="eq-value">{config.eqGains[i] > 0 ? `+${config.eqGains[i]}` : config.eqGains[i]}</div>
                    <div className="eq-slider-wrapper">
                      <input 
                        type="range" 
                        min="-12" 
                        max="12" 
                        step="1" 
                        value={config.eqGains[i]}
                        onChange={(e) => {
                          const newGains = [...config.eqGains]
                          newGains[i] = parseInt(e.target.value)
                          setConfig(prev => ({ ...prev, eqGains: newGains }))
                        }}
                        orient="vertical"
                        style={{ appearance: 'slider-vertical', width: '8px', height: '150px' }}
                      />
                    </div>
                    <div className="eq-label">{label}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="settings-section">
              <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Palette size={20} />
                  <h2>Aesthetics & Themes</h2>
                </div>
                <button 
                  onClick={() => {
                    const theme = generateRandomPalette()
                    setConfig(prev => ({ ...prev, theme: 'custom', customColors: theme }))
                  }}
                  className="btn" style={{ width: 'auto', padding: '0 16px', height: '36px', gap: '8px', fontSize: '13px', fontWeight: 600, background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-pink))', color: 'white', border: 'none', borderRadius: '18px', display: 'flex', alignItems: 'center', boxShadow: '0 4px 15px rgba(247, 170, 181, 0.4)' }}
                >
                  <Wand2 size={16} /> Randomize
                </button>
              </div>
              
              <div className="themes-grid" style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '16px', marginBottom: '24px'
              }}>
                {Object.entries(PRESET_THEMES).map(([key, theme]) => (
                  <div 
                    key={key} 
                    onClick={() => setConfig({...config, theme: key})}
                    style={{
                      position: 'relative', cursor: 'pointer', padding: '16px', borderRadius: '16px',
                      border: `2px solid ${config.theme === key ? 'var(--accent-pink)' : 'transparent'}`,
                      background: 'var(--glass-bg)', color: 'var(--text-main)', 
                      fontWeight: '700', textAlign: 'center',
                      boxShadow: config.theme === key ? '0 8px 24px rgba(247, 170, 181, 0.2)' : '0 4px 12px rgba(0,0,0,0.05)',
                      transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', overflow: 'hidden'
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-4px)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                  >
                    <div style={{
                      width: '100%', height: '40px', borderRadius: '8px',
                      background: `linear-gradient(135deg, ${theme.colors.accent1}, ${theme.colors.accent2})`,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                    }} />
                    <span style={{ fontSize: '13px', zIndex: 1 }}>{theme.name}</span>
                    {config.theme === key && <CheckCircle2 size={18} color="var(--accent-pink)" style={{ position: 'absolute', top: '8px', right: '8px', background: 'white', borderRadius: '50%', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }} />}
                  </div>
                ))}

                <div onClick={() => setConfig({...config, theme: 'custom', customColors: config.customColors || PRESET_THEMES.sakura.colors})} style={{
                    position: 'relative', cursor: 'pointer', padding: '16px', borderRadius: '16px',
                    border: `2px solid ${config.theme === 'custom' ? 'var(--accent-pink)' : 'var(--glass-border)'}`,
                    background: 'var(--glass-bg)', color: 'var(--text-main)',
                    fontWeight: '700', textAlign: 'center',
                    boxShadow: config.theme === 'custom' ? '0 8px 24px rgba(247, 170, 181, 0.2)' : '0 4px 12px rgba(0,0,0,0.05)',
                    transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px'
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-4px)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
                  <div style={{
                      width: '100%', height: '40px', borderRadius: '8px',
                      background: `linear-gradient(135deg, #f7aab5, #a3d2e3, #bbf0d8)`,
                      backgroundSize: 'cover', boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <Palette size={20} color="white" />
                  </div>
                  <span style={{ fontSize: '13px' }}>Custom</span>
                  {config.theme === 'custom' && <CheckCircle2 size={18} color="var(--accent-pink)" style={{ position: 'absolute', top: '8px', right: '8px', background: 'white', borderRadius: '50%', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }} />}
                </div>
              </div>

              <div style={{
                maxHeight: config.theme === 'custom' ? '800px' : '0px',
                opacity: config.theme === 'custom' ? 1 : 0,
                overflow: 'hidden',
                transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
              }}>
                {config.theme === 'custom' && config.customColors && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '12px',
                    background: 'rgba(255,255,255,0.4)', padding: '24px', borderRadius: '16px',
                    border: '1px solid var(--glass-border)',
                    boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.02)',
                  }}>
                    {[
                      { label: 'Background', key: 'bgColor', desc: 'Main window backdrop' },
                      { label: 'Primary Accent', key: 'accent1', desc: 'Main interactions' },
                      { label: 'Secondary Accent', key: 'accent2', desc: 'Gradients & depth' },
                      { label: 'Tertiary Accent', key: 'accent3', desc: 'Highlights' },
                      { label: 'Main Text', key: 'textMain', desc: 'Headers & titles' },
                      { label: 'Soft Text', key: 'textSoft', desc: 'Secondary hints' },
                      { label: 'Glass Color', key: 'glassColor', desc: 'Panel frosted tint' },
                    ].map(field => (
                      <div key={field.key} style={{ 
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                        background: 'var(--glass-bg)', padding: '12px 16px', borderRadius: '12px',
                        border: '1px solid rgba(255,255,255,0.3)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.03)', transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>{field.label}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-soft)', opacity: 0.8 }}>{field.desc}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: 11, opacity: 0.5, fontFamily: 'monospace', background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                            {config.customColors[field.key].toUpperCase()}
                          </span>
                          <div style={{ 
                            position: 'relative', width: '30px', height: '30px', borderRadius: '50%',
                            overflow: 'hidden', border: '2px solid rgba(255,255,255,0.8)',
                            boxShadow: `0 0 10px ${config.customColors[field.key]}60`, flexShrink: 0
                          }}>
                            <input type="color" value={config.customColors[field.key]} onChange={(e) => {
                              setConfig(prev => ({
                                ...prev,
                                customColors: { ...prev.customColors, [field.key]: e.target.value }
                              }))
                            }} style={{ 
                              position: 'absolute', top: '-10px', left: '-10px', width: '50px', height: '50px', 
                              cursor: 'pointer', border: 'none', padding: 0 
                            }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="settings-section">
              <div className="section-title">
                <Image size={20} />
                <h2>Personalization</h2>
              </div>
              
              <div className="setting-row">
                <div className="setting-info">
                  <h3>Custom Background Layer</h3>
                  <p>Select a high-quality image for your workspace backdrop.</p>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {config.customBgPath && (
                    <button 
                      onClick={() => setConfig(prev => ({ ...prev, customBgPath: null }))}
                      style={{ padding: '8px', background: 'var(--accent-pink)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                      Clear
                    </button>
                  )}
                  <label style={{ 
                    padding: '8px 16px', background: 'var(--accent-pink)', color: 'white', 
                    borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' 
                  }}>
                    Browse...
                    <input 
                      type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          const path = e.target.files[0].path
                          setConfig(prev => ({ ...prev, customBgPath: `file:///${path.replace(/\\/g, '/')}` }))
                        }
                      }}
                    />
                  </label>
                </div>
              </div>

              {config.customBgPath && (
                <>
                  <div className="setting-row" style={{ marginTop: '-12px' }}>
                    <div className="setting-info">
                      <h3>Background Opacity</h3>
                      <p>Adjust the brightness of your custom background image.</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '200px' }}>
                      <span style={{ fontSize: 12, opacity: 0.5 }}>0%</span>
                      <input 
                        type="range" min={0} max={1} step={0.05} 
                        value={config.customBgOpacity !== undefined ? config.customBgOpacity : 1.0}
                        onChange={(e) => setConfig(prev => ({ ...prev, customBgOpacity: parseFloat(e.target.value) }))}
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontSize: 12, opacity: 0.5 }}>100%</span>
                    </div>
                  </div>

                  <div className="setting-row">
                    <div className="setting-info">
                      <h3>UI Panel Opacity</h3>
                      <p>Controls the white tint on the glass panels.</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '200px' }}>
                      <span style={{ fontSize: 12, opacity: 0.5 }}>0%</span>
                      <input 
                        type="range" min={0} max={1} step={0.05} 
                        value={config.uiBgOpacity !== undefined ? config.uiBgOpacity : 0.6}
                        onChange={(e) => setConfig(prev => ({ ...prev, uiBgOpacity: parseFloat(e.target.value) }))}
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontSize: 12, opacity: 0.5 }}>100%</span>
                    </div>
                  </div>

                  <div className="setting-row">
                    <div className="setting-info">
                      <h3>UI Glass Blur</h3>
                      <p>Adjust the frosted glass blur intensity.</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '200px' }}>
                      <span style={{ fontSize: 12, opacity: 0.5 }}>0px</span>
                      <input 
                        type="range" min={0} max={40} step={1} 
                        value={config.uiBlur !== undefined ? config.uiBlur : 20}
                        onChange={(e) => setConfig(prev => ({ ...prev, uiBlur: parseInt(e.target.value) }))}
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontSize: 12, opacity: 0.5 }}>40px</span>
                    </div>
                  </div>
                </>
              )}

              <div className="setting-row">
                <div className="setting-info">
                  <h3>Discord Rich Presence</h3>
                  <p>Show your current song, playback state, and engine speed to others.</p>
                </div>
                <button
                  className={`toggle-btn ${config.showDiscordRPC ? 'active' : ''}`}
                  onClick={() => setConfig(prev => ({ ...prev, showDiscordRPC: !prev.showDiscordRPC }))}
                >
                  {config.showDiscordRPC ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                </button>
              </div>
            </section>

            <section className="settings-section">
              <div className="section-title">
                <Info size={20} />
                <h2>About</h2>
              </div>
              <p style={{ opacity: 0.6, fontSize: '14px', lineHeight: 1.6 }}>
                Echoes Studio is a high-performance Nightcore audio engine. 
                All signal processing is done in 32-bit floating point precision 
                via the Web Audio API for uncompromised quality.
              </p>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
