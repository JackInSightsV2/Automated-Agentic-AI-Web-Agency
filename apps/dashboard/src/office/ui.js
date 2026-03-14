/**
 * Office UI — Name tags (name + job title), speech bubbles
 * Adapted from pixel-agent-desk office-ui.js
 */

import { STATE_COLORS } from './config.js'

const OFFICE_UI_BASE_Y = -66

export function drawOfficeNameTag(ctx, agent) {
  const baseX = Math.round(agent.x)
  const footY = Math.round(agent.y)

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'

  const statusColor = STATE_COLORS[agent.agentState] || '#94a3b8'

  // Name (bold, white)
  ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif'
  let nameStr = agent.role || 'Agent'
  if (nameStr.length > 22) nameStr = nameStr.slice(0, 20) + '...'

  // Title (smaller, dimmer)
  ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif'
  let titleStr = agent.title || ''
  if (titleStr.length > 24) titleStr = titleStr.slice(0, 22) + '...'

  // Measure both lines
  ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif'
  const nameTw = ctx.measureText(nameStr).width
  ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif'
  const titleTw = titleStr ? ctx.measureText(titleStr).width : 0
  const maxTw = Math.max(nameTw, titleTw)

  const boxW = maxTw + 18
  const boxH = titleStr ? 28 : 16
  const boxX = baseX - boxW / 2
  const boxY = footY + OFFICE_UI_BASE_Y - boxH

  // Background
  ctx.fillStyle = 'rgba(15, 23, 42, 0.92)'
  ctx.strokeStyle = statusColor
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(boxX, boxY, boxW, boxH, 5)
  ctx.fill()
  ctx.stroke()

  // Name text
  ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif'
  ctx.fillStyle = '#f8fafc'
  if (titleStr) {
    ctx.fillText(nameStr, baseX, boxY + 13)
  } else {
    ctx.fillText(nameStr, baseX, boxY + boxH - 3)
  }

  // Title text (dimmer, below name)
  if (titleStr) {
    ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.fillStyle = '#94a3b8'
    ctx.fillText(titleStr, baseX, boxY + 25)
  }

  // Status badge (pill above the name tag)
  const state = agent.agentState || 'idle'
  const displayState = state === 'done' ? 'DONE' : state === 'idle' ? 'RESTING' : state === 'paused' ? 'PAUSED' : state.toUpperCase()

  ctx.font = 'bold 9px sans-serif'
  const stateTw = ctx.measureText(displayState).width

  ctx.globalAlpha = 0.8
  ctx.fillStyle = statusColor
  const paddingX = 8
  const sBoxW = stateTw + paddingX * 2
  const sBoxH = 14
  const sBoxX = baseX - sBoxW / 2
  const sBoxY = boxY - sBoxH - 3

  ctx.beginPath()
  ctx.roundRect(sBoxX, sBoxY, sBoxW, sBoxH, sBoxH / 2)
  ctx.fill()

  ctx.globalAlpha = 1.0
  ctx.fillStyle = '#ffffff'
  ctx.fillText(displayState, baseX, sBoxY + sBoxH - 3)

  ctx.restore()
}

export function drawOfficeBubble(ctx, agent) {
  const now = Date.now()
  const baseX = Math.round(agent.x)
  const bubbleY = Math.round(agent.y) + OFFICE_UI_BASE_Y - 55

  ctx.save()

  if (agent.bubble && agent.bubble.expiresAt > now) {
    const text = agent.bubble.text
    const isThought = agent.bubble.thinking
    const isRest = agent.bubble.rest

    // Fade in/out for thinking bubbles
    let alpha = 1
    if (isThought) {
      const remaining = agent.bubble.expiresAt - now
      const total = 5500
      const elapsed = total - remaining
      if (elapsed < 400) alpha = elapsed / 400  // fade in
      if (remaining < 600) alpha = remaining / 600  // fade out
    }
    if (isRest) {
      const remaining = agent.bubble.expiresAt - now
      if (remaining < 300) alpha = remaining / 300
    }

    ctx.globalAlpha = alpha

    ctx.font = isRest ? 'italic 10px -apple-system, sans-serif' : 'bold 11px -apple-system, BlinkMacSystemFont, sans-serif'
    const tw = ctx.measureText(text).width
    const paddingH = 10
    const paddingV = 8
    const boxW = tw + paddingH * 2
    const boxH = (isRest ? 14 : 16) + paddingV * 2
    const boxX = baseX - boxW / 2
    const boxY = bubbleY - boxH

    // Bubble background
    const bgColor = isThought ? 'rgba(240, 240, 255, 0.92)' : isRest ? 'rgba(255, 248, 230, 0.9)' : 'rgba(255, 255, 255, 0.95)'
    ctx.fillStyle = bgColor
    ctx.beginPath()
    ctx.roundRect(boxX, boxY, boxW, boxH, 8)
    ctx.fill()

    // Border
    ctx.lineWidth = isThought ? 1.5 : 2
    ctx.strokeStyle = isThought ? 'rgba(139, 92, 246, 0.4)' : isRest ? 'rgba(251, 191, 36, 0.4)' : 'rgba(203, 213, 225, 0.5)'
    ctx.stroke()

    if (isThought) {
      // Thought dots (3 circles instead of a tail)
      ctx.fillStyle = bgColor
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.4)'
      ctx.lineWidth = 1

      ctx.beginPath()
      ctx.arc(baseX - 2, boxY + boxH + 5, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(baseX + 4, boxY + boxH + 11, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(baseX + 8, boxY + boxH + 15, 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    } else {
      // Speech tail
      ctx.fillStyle = bgColor
      ctx.beginPath()
      ctx.moveTo(baseX - 6, boxY + boxH)
      ctx.lineTo(baseX + 6, boxY + boxH)
      ctx.lineTo(baseX, boxY + boxH + 7)
      ctx.closePath()
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = isRest ? 'rgba(251, 191, 36, 0.4)' : 'rgba(203, 213, 225, 0.5)'
      ctx.stroke()
    }

    // Text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = isThought ? '#4c1d95' : isRest ? '#92400e' : '#0f172a'
    ctx.fillText(text, baseX, boxY + boxH / 2)
  }

  ctx.restore()
}
