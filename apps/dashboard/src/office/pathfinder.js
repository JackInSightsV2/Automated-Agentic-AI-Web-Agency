/**
 * Office Pathfinder — A* pathfinding on collision map
 * Adapted from pixel-agent-desk office-pathfinder.js
 */

import { OFFICE } from './config.js'
import { loadOfficeImage } from './layers.js'

export const officePathfinder = {
  grid: [],
  gridW: 0,
  gridH: 0,

  async init(bgW, bgH) {
    const TILE = OFFICE.TILE_SIZE
    const img = await loadOfficeImage('/office/map/office_collision.webp?t=' + Date.now())
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data

    this.gridW = Math.ceil(bgW / TILE)
    this.gridH = Math.ceil(bgH / TILE)

    const scaleX = canvas.width / bgW
    const scaleY = canvas.height / bgH

    this.grid = []
    for (let gy = 0; gy < this.gridH; gy++) {
      this.grid[gy] = []
      for (let gx = 0; gx < this.gridW; gx++) {
        const px = Math.floor((gx + 0.5) * TILE * scaleX)
        const py = Math.floor((gy + 0.5) * TILE * scaleY)
        const idx = (py * canvas.width + px) * 4
        this.grid[gy][gx] = data[idx + 3] < 128 // transparent = walkable
      }
    }
  },

  isWalkable(gx, gy) {
    if (gx < 0 || gy < 0 || gx >= this.gridW || gy >= this.gridH) return false
    return this.grid[gy][gx]
  },

  findNearestWalkable(gx, gy) {
    for (let r = 1; r < 10; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (this.isWalkable(gx + dx, gy + dy)) return { x: gx + dx, y: gy + dy }
        }
      }
    }
    return { x: gx, y: gy }
  },

  findPath(startX, startY, endX, endY) {
    const TILE = OFFICE.TILE_SIZE
    if (this.gridW === 0) return [{ x: endX, y: endY }]

    let sgx = Math.max(0, Math.min(this.gridW - 1, Math.floor(startX / TILE)))
    let sgy = Math.max(0, Math.min(this.gridH - 1, Math.floor(startY / TILE)))
    let egx = Math.max(0, Math.min(this.gridW - 1, Math.floor(endX / TILE)))
    let egy = Math.max(0, Math.min(this.gridH - 1, Math.floor(endY / TILE)))

    if (!this.isWalkable(sgx, sgy)) {
      const ns = this.findNearestWalkable(sgx, sgy)
      sgx = ns.x; sgy = ns.y
    }
    if (!this.isWalkable(egx, egy)) {
      const ne = this.findNearestWalkable(egx, egy)
      egx = ne.x; egy = ne.y
    }
    if (sgx === egx && sgy === egy) return [{ x: endX, y: endY }]

    const openSet = []
    const closedSet = {}
    const h0 = Math.abs(sgx - egx) + Math.abs(sgy - egy)
    openSet.push({ x: sgx, y: sgy, g: 0, h: h0, f: h0, parent: null })

    const dirs = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]]

    while (openSet.length > 0) {
      openSet.sort((a, b) => a.f - b.f)
      const current = openSet.shift()
      const key = current.x + ',' + current.y

      if (current.x === egx && current.y === egy) {
        const path = []
        let node = current
        while (node) {
          path.unshift({ x: node.x * TILE + 16, y: node.y * TILE + 16 })
          node = node.parent
        }
        path.shift()
        if (path.length > 0) {
          path[path.length - 1] = { x: endX, y: endY }
        }
        return path
      }

      closedSet[key] = true

      for (let i = 0; i < dirs.length; i++) {
        const dx = dirs[i][0], dy = dirs[i][1]
        const nx = current.x + dx, ny = current.y + dy
        if (!this.isWalkable(nx, ny) || closedSet[nx + ',' + ny]) continue

        const cost = (dx !== 0 && dy !== 0) ? 1.4 : 1
        const g = current.g + cost
        const h = Math.abs(nx - egx) + Math.abs(ny - egy)
        const f = g + h

        let existing = null
        for (let j = 0; j < openSet.length; j++) {
          if (openSet[j].x === nx && openSet[j].y === ny) { existing = openSet[j]; break }
        }
        if (!existing) {
          openSet.push({ x: nx, y: ny, g, h, f, parent: current })
        } else if (g < existing.g) {
          existing.g = g
          existing.f = f
          existing.parent = current
        }
      }

      if (Object.keys(closedSet).length > 2000) break
    }

    return [{ x: endX, y: endY }]
  },
}
