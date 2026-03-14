/**
 * Office Sprite — Sprite sheet loading, drawing, animation ticking
 * Adapted from pixel-agent-desk office-sprite.js
 */

import { OFFICE, SPRITE_FRAMES, IDLE_ANIM_KEYS, AVATAR_FILES } from './config.js'

const officeSkinImages = {}

export function loadAllOfficeSkins() {
  const ts = Date.now()
  const promises = []
  for (let i = 0; i < AVATAR_FILES.length; i++) {
    const filename = AVATAR_FILES[i]
    const img = new Image()
    img.src = '/characters/' + filename + '?v=' + ts
    officeSkinImages[filename] = img
    promises.push(new Promise(function (resolve) {
      if (img.complete) { resolve(); return }
      img.onload = function () { resolve() }
      img.onerror = function () {
        console.error('[OfficeSprite] Failed to load:', img.src)
        resolve()
      }
    }))
  }
  return Promise.all(promises)
}

export function getOfficeSkinImage(avatarFile) {
  return officeSkinImages[avatarFile] || officeSkinImages[AVATAR_FILES[0]]
}

export function drawOfficeSprite(ctx, agent) {
  const img = getOfficeSkinImage(agent.avatarFile)
  if (!img || !img.complete || img.naturalWidth === 0) return

  const frames = SPRITE_FRAMES[agent.currentAnim]
  if (!frames) return
  const frameIdx = frames[agent.animFrame % frames.length]

  const sx = (frameIdx % OFFICE.COLS) * OFFICE.FRAME_W
  const sy = Math.floor(frameIdx / OFFICE.COLS) * OFFICE.FRAME_H

  ctx.drawImage(
    img,
    sx, sy, OFFICE.FRAME_W, OFFICE.FRAME_H,
    Math.round(agent.x - OFFICE.FRAME_W / 2),
    Math.round(agent.y - OFFICE.FRAME_H),
    OFFICE.FRAME_W, OFFICE.FRAME_H
  )
}

export function tickOfficeAnimation(agent, deltaMs) {
  agent.animTimer += deltaMs
  const interval = IDLE_ANIM_KEYS.has(agent.currentAnim) ? OFFICE.IDLE_ANIM_INTERVAL : OFFICE.ANIM_INTERVAL
  if (agent.animTimer >= interval) {
    agent.animTimer -= interval
    const frames = SPRITE_FRAMES[agent.currentAnim]
    if (frames) {
      agent.animFrame = (agent.animFrame + 1) % frames.length
    }
  }
}

export function animKeyFromDir(dir, moving) {
  if (moving) return 'walk_' + dir
  return dir + '_idle'
}
