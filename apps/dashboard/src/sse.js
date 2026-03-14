export function createSSE(onUpdate) {
  let source = null
  let reconnectTimer = null
  let stopped = false

  function connect() {
    if (stopped) return
    if (source) source.close()

    source = new EventSource('/events/stream')

    source.addEventListener('update', (event) => {
      try {
        const data = JSON.parse(event.data)
        onUpdate(data)
      } catch (err) {
        console.error('[SSE] Parse error:', err)
      }
    })

    source.onerror = () => {
      source.close()
      source = null
      // Only reconnect if not stopped — back off to 5s to avoid spam
      if (!stopped) {
        if (reconnectTimer) clearTimeout(reconnectTimer)
        reconnectTimer = setTimeout(connect, 5000)
      }
    }
  }

  connect()

  return {
    close() {
      stopped = true
      if (source) { source.close(); source = null }
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    },
  }
}
