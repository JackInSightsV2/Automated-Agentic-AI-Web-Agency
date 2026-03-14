/**
 * Office Character — Agent ↔ character mapping, movement, state→zone logic
 * Adapted from pixel-agent-desk office-character.js for pipeline agents
 */

import {
  OFFICE, AVATAR_FILES, avatarIndexFromId, getSeatConfig,
  IDLE_SEAT_MAP, STATE_ZONE_MAP, STATE_COLORS, PIPELINE_AGENTS,
} from './config.js'
import { officeLayers } from './layers.js'
import { officeCoords } from './coords.js'
import { officePathfinder } from './pathfinder.js'
import { tickOfficeAnimation, animKeyFromDir } from './sprite.js'

export const officeCharacters = {
  characters: new Map(),
  seatAssignments: new Map(),

  /** Initialize all pipeline agents as characters */
  initPipelineAgents() {
    for (const agent of PIPELINE_AGENTS) {
      this.addCharacter({
        id: agent.id,
        name: agent.name,
        status: 'idle',
        avatarIndex: agent.avatar,
      })
    }
  },

  addCharacter(agentData) {
    if (this.characters.has(agentData.id)) {
      this.updateCharacter(agentData)
      return
    }

    const officeState = this._mapStatus(agentData.status)
    const avatarIdx = (agentData.avatarIndex !== undefined && agentData.avatarIndex !== null)
      ? agentData.avatarIndex : avatarIndexFromId(agentData.id)
    const avatarFile = AVATAR_FILES[avatarIdx] || AVATAR_FILES[0]

    const char = {
      id: agentData.id,
      x: (officeLayers.width || 800) / 2 + (Math.random() - 0.5) * 80,
      y: (officeLayers.height || 800) / 2 + (Math.random() - 0.5) * 80,
      path: [],
      pathIndex: 0,
      facingDir: 'down',
      avatarFile,
      skinIndex: avatarIdx,
      deskIndex: undefined,
      deskOverflow: false,
      currentAnim: 'down_idle',
      animFrame: 0,
      animTimer: 0,
      agentState: officeState,
      restTimer: 0,
      bubble: null,
      role: agentData.name || 'Agent',
      title: agentData.title || '',
      metadata: {
        name: agentData.name || 'Agent',
        status: agentData.status || 'idle',
        lastMessage: agentData.lastMessage || null,
        type: agentData.type || 'main',
      },
    }

    this.characters.set(agentData.id, char)

    if (STATE_ZONE_MAP[officeState] === 'desk') {
      this.assignDesk(agentData.id)
    }

    this._updateTarget(char)
    this._setBubble(char, agentData)
  },

  updateCharacter(agentData) {
    const char = this.characters.get(agentData.id)
    if (!char) {
      this.addCharacter(agentData)
      return
    }

    const oldState = char.agentState
    const newState = this._mapStatus(agentData.status)
    char.agentState = newState
    char.role = agentData.name || char.role
    if (agentData.title) char.title = agentData.title
    char.metadata.status = agentData.status || 'idle'
    char.metadata.lastMessage = agentData.lastMessage || char.metadata.lastMessage

    if (oldState !== newState) {
      const oldZone = STATE_ZONE_MAP[oldState] || 'idle'
      const newZone = STATE_ZONE_MAP[newState] || 'idle'

      if (newZone === 'desk' && char.deskIndex === undefined) {
        this.assignDesk(agentData.id)
      } else if (newZone === 'idle' && oldZone === 'desk') {
        this.releaseDesk(agentData.id)
      }

      // State change effects — stored for renderer to pick up
      char._pendingEffect = newState
    }

    this._setBubble(char, agentData)
    this._updateTarget(char)
  },

  removeCharacter(agentId) {
    this.releaseDesk(agentId)
    this.characters.delete(agentId)
  },

  assignDesk(agentId) {
    const char = this.characters.get(agentId)
    if (!char || char.deskIndex !== undefined) return

    const usedDesks = new Set(this.seatAssignments.keys())
    const deskCoords = officeCoords.desk || []
    const available = []
    for (let i = 0; i < deskCoords.length; i++) {
      if (!usedDesks.has(i)) available.push(i)
    }

    if (available.length === 0) {
      char.deskOverflow = true
      return
    }

    const hash = avatarIndexFromId(agentId)
    const idx = available[hash % available.length]
    char.deskIndex = idx
    this.seatAssignments.set(idx, agentId)
  },

  releaseDesk(agentId) {
    const char = this.characters.get(agentId)
    if (!char) return
    if (char.deskIndex !== undefined) {
      this.seatAssignments.delete(char.deskIndex)
      char.deskIndex = undefined
    }
    char.deskOverflow = false
  },

  updateAll(deltaSec, deltaMs) {
    const self = this
    this.characters.forEach(function (char) {
      self._updateTarget(char)
      self._updateMovement(char, deltaSec)
      tickOfficeAnimation(char, deltaMs)
    })
  },

  _updateTarget(char) {
    const coords = officeCoords
    if (!coords || !coords.desk || !coords.idle) return

    // WORKING / ERROR → always at desk
    if (char.agentState === 'working' || char.agentState === 'error') {
      char.restTimer = 0
      char._onBreak = false

      if (char.deskOverflow) {
        if (char.path.length > 0 && char.pathIndex < char.path.length) return
        const nearIdle = this._findNearDeskIdleSpot(char)
        if (nearIdle) {
          if (Math.abs(char.x - nearIdle.x) < 5 && Math.abs(char.y - nearIdle.y) < 5) return
          char.path = officePathfinder.findPath(char.x, char.y, nearIdle.x, nearIdle.y)
          char.pathIndex = 0
        }
        return
      }

      if (char.deskIndex !== undefined && char.deskIndex < coords.desk.length) {
        const target = coords.desk[char.deskIndex]
        const tx = Math.floor(target.x)
        const ty = Math.floor(target.y)

        if (char.path.length === 0 && Math.floor(char.x) === tx && Math.floor(char.y) === ty) return
        if (char.path.length > 0) {
          const last = char.path[char.path.length - 1]
          if (Math.floor(last.x) === tx && Math.floor(last.y) === ty) return
        }

        char.path = officePathfinder.findPath(char.x, char.y, tx, ty)
        char.pathIndex = 0
      }
      return
    }

    // THINKING → stay put wherever you are. No movement. Just show a thought bubble.
    // Thinking is brief and rare — agent stays in idle zone with a bubble, then goes back to idle.
    if (char.agentState === 'thinking') {
      // Don't move — just sit where you are
      return
    }

    // IDLE / DONE / PAUSED → idle zone
    if (char.path.length > 0 && char.pathIndex < char.path.length) return

    const isAtIdle = coords.idle.some(function (p) {
      return Math.abs(p.x - char.x) < 5 && Math.abs(p.y - char.y) < 5
    })

    if (isAtIdle) return

    const occupied = {}
    this.characters.forEach(function (a) {
      if (a.id === char.id) return
      let ax = Math.floor(a.x), ay = Math.floor(a.y)
      if (a.path.length > 0) {
        const t = a.path[a.path.length - 1]
        ax = Math.floor(t.x)
        ay = Math.floor(t.y)
      }
      occupied[ax + ',' + ay] = true
    })

    const valid = coords.idle.filter(function (p) {
      return !occupied[Math.floor(p.x) + ',' + Math.floor(p.y)]
    })

    if (valid.length > 0) {
      const dest = valid[Math.floor(Math.random() * valid.length)]
      char.path = officePathfinder.findPath(char.x, char.y, dest.x, dest.y)
      char.pathIndex = 0
    }
  },

  _updateMovement(char, deltaSec) {
    const isArrived = char.path.length === 0 || char.pathIndex >= char.path.length

    if (isArrived) {
      const allSpots = (officeCoords.desk || []).concat(officeCoords.idle || [])
      let currentSpot = null
      for (let i = 0; i < allSpots.length; i++) {
        if (Math.abs(allSpots[i].x - char.x) < 5 && Math.abs(allSpots[i].y - char.y) < 5) {
          currentSpot = allSpots[i]
          break
        }
      }

      if (char.agentState === 'done') {
        if (currentSpot && currentSpot.type === 'idle') {
          const entry = IDLE_SEAT_MAP[currentSpot.id]
          char.currentAnim = (entry === 'dance') ? 'dance' : 'sit_' + (entry || 'down')
        } else {
          char.currentAnim = 'dance'
        }
      } else if (char.deskOverflow) {
        char.facingDir = 'down'
        char.currentAnim = 'down_idle'
      } else if (char.agentState === 'error') {
        char.currentAnim = 'alert_jump'
      } else if (char.agentState === 'paused') {
        // Paused agents sit idle
        if (currentSpot && currentSpot.type === 'idle') {
          const idleConfig = getSeatConfig(currentSpot.id)
          char.currentAnim = 'sit_' + idleConfig.dir
        } else {
          char.currentAnim = 'sit_down'
        }
      } else if (currentSpot && currentSpot.type === 'idle') {
        const idleConfig = getSeatConfig(currentSpot.id)
        char.facingDir = idleConfig.dir
        char.currentAnim = idleConfig.animType === 'sit' ? 'sit_' + idleConfig.dir : idleConfig.dir + '_idle'
      } else {
        // Desk spot
        const config = currentSpot ? getSeatConfig(currentSpot.id) : { dir: 'down', animType: 'sit' }
        char.facingDir = config.dir
        if (config.animType === 'sit') {
          const isWorking = char.agentState === 'working' || char.agentState === 'thinking'
          char.currentAnim = (isWorking ? 'sit_work_' : 'sit_') + config.dir
        } else {
          char.currentAnim = config.dir + '_idle'
        }
      }
      return
    }

    // Move along path
    const target = char.path[char.pathIndex]
    const dx = target.x - char.x
    const dy = target.y - char.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < OFFICE.ARRIVE_THRESHOLD) {
      char.x = target.x
      char.y = target.y
      char.pathIndex++
    } else {
      // Thinking agents walk slower (ambling pace)
      const baseSpeed = (char.agentState === 'thinking' || char._onBreak) ? OFFICE.MOVE_SPEED * 0.5 : OFFICE.MOVE_SPEED
      const speed = baseSpeed * deltaSec
      char.x += (dx / dist) * speed
      char.y += (dy / dist) * speed
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
      char.facingDir = dir
      char.currentAnim = animKeyFromDir(dir, true)
    }
  },

  _mapStatus(dashboardStatus) {
    const map = {
      working:   'working',
      thinking:  'thinking',
      idle:      'idle',
      done:      'done',
      error:     'error',
      paused:    'paused',
    }
    return map[dashboardStatus] || 'idle'
  },

  _setBubble(char, agentData) {
    let text = null
    const status = agentData.status || char.metadata.status
    const now = Date.now()

    if (status === 'working' && agentData.lastMessage) {
      text = agentData.lastMessage.length > 30
        ? agentData.lastMessage.slice(0, 27) + '...'
        : agentData.lastMessage
      char.bubble = { text, expiresAt: Infinity }
    } else if (status === 'thinking' && agentData.lastMessage) {
      // Each agent gets a unique cycle length and offset so they're never in sync
      const hash = avatarIndexFromId(char.id)
      const cycleLen = 10000 + (hash % 7) * 3000  // 10s to 28s per cycle, unique per agent
      const offset = (hash * 3571) % cycleLen  // pseudo-random offset
      const phase = (now + offset) % cycleLen

      // Show thought for 60% of cycle, rest for 40%
      const showDuration = cycleLen * 0.6
      const restDuration = cycleLen * 0.4

      if (phase < showDuration) {
        text = agentData.lastMessage.length > 30
          ? agentData.lastMessage.slice(0, 27) + '...'
          : agentData.lastMessage
        char.bubble = { text, expiresAt: now + 3000, thinking: true }
        char._restBubbleShown = false
      } else {
        // Rest — occasionally show a rest action
        const restPhase = phase - showDuration
        const restMid = restDuration * 0.5
        if (Math.abs(restPhase - restMid) < 1200 && !char._restBubbleShown) {
          const restMessages = ['*stretches*', '*sips coffee*', '*checks phone*', '*yawns*', '*deep breath*', '*cracks knuckles*', '*looks out window*', '*taps desk*']
          const restMsg = restMessages[(hash + Math.floor(now / cycleLen)) % restMessages.length]
          char.bubble = { text: restMsg, expiresAt: now + 2000, rest: true }
          char._restBubbleShown = true
        } else if (restPhase < restMid * 0.3) {
          char._restBubbleShown = false
          char.bubble = null
        }
      }
    } else if (status === 'done') {
      char.bubble = { text: 'Done!', expiresAt: now + 5000 }
    } else if (status === 'error') {
      char.bubble = { text: 'Error!', expiresAt: Infinity }
    } else if (status === 'paused') {
      char.bubble = { text: 'Zzz...', expiresAt: Infinity }
    } else {
      char.bubble = null
    }
  },

  _findNearDeskIdleSpot(char) {
    const coords = officeCoords
    if (!coords || !coords.idle || !coords.desk || coords.desk.length === 0) return null

    let avgX = 0, avgY = 0
    for (let i = 0; i < coords.desk.length; i++) {
      avgX += coords.desk[i].x
      avgY += coords.desk[i].y
    }
    avgX /= coords.desk.length
    avgY /= coords.desk.length

    const occupied = {}
    this.characters.forEach(function (a) {
      if (a.id === char.id) return
      let ax = Math.floor(a.x), ay = Math.floor(a.y)
      if (a.path.length > 0) {
        const t = a.path[a.path.length - 1]
        ax = Math.floor(t.x); ay = Math.floor(t.y)
      }
      occupied[ax + ',' + ay] = true
    })

    const candidates = coords.idle.filter(function (p) {
      return !occupied[Math.floor(p.x) + ',' + Math.floor(p.y)]
    }).sort(function (a, b) {
      const da = Math.abs(a.x - avgX) + Math.abs(a.y - avgY)
      const db = Math.abs(b.x - avgX) + Math.abs(b.y - avgY)
      return da - db
    })

    if (candidates.length === 0) return null
    const idHash = avatarIndexFromId(char.id)
    return candidates[idHash % Math.min(candidates.length, 5)]
  },

  getCharacterArray() {
    return Array.from(this.characters.values())
  },
}
