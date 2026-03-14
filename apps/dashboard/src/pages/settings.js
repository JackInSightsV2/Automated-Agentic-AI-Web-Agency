import { renderConfigPanel } from '../components/config-panel.js'
import { api } from '../api.js'

export async function renderSettingsPage(container) {
  const { config } = await api.getConfig()
  renderConfigPanel(container, config)
}
