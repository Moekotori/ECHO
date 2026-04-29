import { parentPort, workerData } from 'worker_threads'
import { detectBpmInProcess } from './detectBpmCore.js'

async function run() {
  try {
    const result = await detectBpmInProcess(workerData?.filePath)
    parentPort?.postMessage({
      success: true,
      result: result || {
        bpm: null,
        confidence: 0,
        backend: 'bpm-worker-empty'
      }
    })
  } catch (error) {
    parentPort?.postMessage({
      success: false,
      error: error?.message || String(error)
    })
  }
}

run()
