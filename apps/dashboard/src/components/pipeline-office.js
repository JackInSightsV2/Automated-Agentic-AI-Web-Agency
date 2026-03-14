import { initOffice, updateOfficeFromSSE } from '../office/canvas.js'

export async function renderPipelineOffice(container) {
  const wrapper = document.createElement('div')
  wrapper.className = 'pipeline-office'
  wrapper.style.position = 'relative'

  const canvas = document.createElement('canvas')
  canvas.id = 'office-canvas'
  canvas.style.width = '100%'
  canvas.style.display = 'block'
  canvas.style.imageRendering = 'pixelated'
  wrapper.appendChild(canvas)

  container.appendChild(wrapper)

  await initOffice(canvas)

  return {
    update(data) {
      updateOfficeFromSSE(data)
    },
  }
}
