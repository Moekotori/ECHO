import { Worker } from 'worker_threads'

const BPM_WORKER_TIMEOUT_MS = 45000

function emptyResult(backend, error = null) {
  return {
    bpm: null,
    confidence: 0,
    backend,
    error: error?.message || error || null
  }
}

export function detectBpm(filePath) {
  return new Promise((resolve) => {
    let settled = false
    let worker = null

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (worker) {
        worker.removeAllListeners()
        worker.terminate().catch(() => {})
      }
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish(emptyResult('bpm-worker-timeout', 'BPM detection timed out'))
    }, BPM_WORKER_TIMEOUT_MS)

    try {
      worker = new Worker(new URL('./detectBpmWorker.js', import.meta.url), {
        type: 'module',
        workerData: { filePath }
      })

      worker.once('message', (message) => {
        if (message?.success) {
          finish(message.result || emptyResult('bpm-worker-empty'))
          return
        }
        finish(emptyResult('bpm-worker-error', message?.error || 'BPM worker failed'))
      })

      worker.once('error', (error) => {
        console.warn('[BPM] Worker failed:', error?.message || error)
        finish(emptyResult('bpm-worker-error', error))
      })

      worker.once('exit', (code) => {
        if (code !== 0) {
          finish(emptyResult('bpm-worker-exit', `BPM worker exited with code ${code}`))
        }
      })
    } catch (error) {
      console.warn('[BPM] Worker startup failed:', error?.message || error)
      finish(emptyResult('bpm-worker-startup-error', error))
    }
  })
}
