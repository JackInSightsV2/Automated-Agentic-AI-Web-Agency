/**
 * Office Coords — Parse office_xy.webp and office_laptop.webp for coordinates
 * Adapted from pixel-agent-desk office-coords.js
 */

import { OFFICE } from './config.js'
import { loadOfficeImage } from './layers.js'

export const officeCoords = {
  idle: [],
  desk: [],
  laptopSpots: [],
}

export async function parseMapCoordinates(bgW, bgH) {
  const img = await loadOfficeImage('/office/map/office_xy.webp?t=' + Date.now())
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data

  const scaleX = bgW / canvas.width
  const scaleY = bgH / canvas.height

  const THRESHOLD = 80
  const TILE = OFFICE.TILE_SIZE
  const tempIdle = []
  const tempDesk = []
  const tempMeeting = []
  const seenGrid = {}

  function colorMatch(r, g, b, tr, tg, tb) {
    return Math.abs(r - tr) < THRESHOLD && Math.abs(g - tg) < THRESHOLD && Math.abs(b - tb) < THRESHOLD
  }

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const idx = (y * canvas.width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const a = data[idx + 3]
      if (a < 128) continue

      const mapX = x * scaleX
      const mapY = y * scaleY
      const gx = Math.floor(mapX / TILE)
      const gy = Math.floor(mapY / TILE)
      const key = gx + ',' + gy

      if (seenGrid[key]) continue
      seenGrid[key] = true

      const finalX = gx * TILE + 16
      const finalY = gy * TILE + 32

      if (colorMatch(r, g, b, 0, 255, 0) || colorMatch(r, g, b, 0, 0, 0)) {
        tempIdle.push({ x: finalX, y: finalY })
      } else if (colorMatch(r, g, b, 0, 0, 255)) {
        tempDesk.push({ x: finalX, y: finalY })
      } else if (colorMatch(r, g, b, 255, 255, 0)) {
        tempMeeting.push({ x: finalX, y: finalY })
      }
    }
  }

  let globalId = 0
  officeCoords.desk = []
  officeCoords.idle = []

  tempDesk.forEach((p) => {
    officeCoords.desk.push({ x: p.x, y: p.y, id: globalId++, type: 'desk' })
  })
  tempMeeting.forEach((p) => {
    officeCoords.desk.push({ x: p.x, y: p.y, id: globalId++, type: 'meeting' })
  })
  tempIdle.forEach((p) => {
    officeCoords.idle.push({ x: p.x, y: p.y, id: globalId++, type: 'idle' })
  })

  return officeCoords
}

export async function parseObjectCoordinates(bgW, bgH) {
  const img = await loadOfficeImage('/office/objects/office_laptop.webp?t=' + Date.now())
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data

  const scaleX = bgW / canvas.width
  const scaleY = bgH / canvas.height

  const THRESHOLD = 80
  const TILE = OFFICE.TILE_SIZE
  const spots = []
  const seenGrid = {}

  function colorMatch(r, g, b, tr, tg, tb) {
    return Math.abs(r - tr) < THRESHOLD && Math.abs(g - tg) < THRESHOLD && Math.abs(b - tb) < THRESHOLD
  }

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const idx = (y * canvas.width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const a = data[idx + 3]
      if (a < 128) continue

      let dir = null
      if (colorMatch(r, g, b, 255, 128, 0)) dir = 'left'
      else if (colorMatch(r, g, b, 0, 255, 255)) dir = 'down'
      else if (colorMatch(r, g, b, 255, 0, 255)) dir = 'up'
      else if (colorMatch(r, g, b, 0, 0, 255)) dir = 'right'
      else continue

      const mapX = x * scaleX
      const mapY = y * scaleY
      const gx = Math.floor(mapX / TILE)
      const gy = Math.floor(mapY / TILE)
      const key = gx + ',' + gy
      if (seenGrid[key]) continue
      seenGrid[key] = true

      spots.push({ x: gx * TILE, y: gy * TILE, dir })
    }
  }

  officeCoords.laptopSpots = spots
  return spots
}
