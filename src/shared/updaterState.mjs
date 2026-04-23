const REUSABLE_EVENTS = new Set(['update-available', 'download-progress', 'update-downloaded'])

export function buildUpdaterEventDedupeKey(event, data = {}) {
  const payload = { event, ...data }
  if (event === 'download-progress') {
    return `${event}:${Math.round(payload.percent || 0)}`
  }
  return JSON.stringify(payload)
}

export function shouldReuseUpdaterState(currentEvent) {
  return Boolean(currentEvent?.event && REUSABLE_EVENTS.has(currentEvent.event))
}

export function shouldReplayUpdaterEvent(previousKey, event, data = {}) {
  return buildUpdaterEventDedupeKey(event, data) !== previousKey
}
