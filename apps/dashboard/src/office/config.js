/**
 * Office Config — Constants, sprite frame map, seat configs, state mappings
 * Adapted from pixel-agent-desk office-config.js
 */

export const OFFICE = {
  TILE_SIZE: 32,
  FRAME_W: 48,
  FRAME_H: 64,
  COLS: 8,
  ANIM_FPS: 8,
  ANIM_INTERVAL: 1000 / 8,
  IDLE_ANIM_INTERVAL: 1000 / 2,
  MOVE_SPEED: 110,
  ARRIVE_THRESHOLD: 2,
}

export let SPRITE_FRAMES = {}

export async function loadSpriteFrames() {
  try {
    const res = await fetch('/shared/sprite-frames.json')
    const data = await res.json()
    const f = data.frames

    OFFICE.FRAME_W = data.sheet.frameWidth
    OFFICE.FRAME_H = data.sheet.frameHeight
    OFFICE.COLS = data.sheet.cols

    SPRITE_FRAMES = {
      down_idle:      f.front_idle,
      walk_down:      f.front_walk,
      left_idle:      f.left_idle,
      walk_left:      f.left_walk,
      right_idle:     f.right_idle,
      walk_right:     f.right_walk,
      up_idle:        f.back_idle,
      walk_up:        f.back_walk,
      dance:          f.front_done_dance,
      alert_jump:     f.front_alert_jump,
      sit_down:       f.front_sit_idle,
      sit_left:       f.left_sit_idle,
      sit_right:      f.right_sit_idle,
      sit_up:         f.back_sit_idle,
      sit_work_down:  f.front_sit_work,
      sit_work_left:  f.left_sit_work,
      sit_work_right: f.right_sit_work,
      sit_work_up:    f.back_sit_work,
    }
  } catch (e) {
    console.error('[OfficeConfig] Failed to load sprite-frames.json:', e)
  }
}

export const IDLE_ANIM_KEYS = new Set([
  'down_idle', 'left_idle', 'right_idle', 'up_idle',
  'sit_down', 'sit_left', 'sit_right', 'sit_up',
  'dance',
])

// Seat direction/pose config (global ID → pose)
export const SEAT_MAP = {
  10: { dir: 'right', animType: 'sit' },
  12: { dir: 'right', animType: 'sit' },
  18: { dir: 'right', animType: 'sit' },
  28: { dir: 'right', animType: 'sit' },
  11: { dir: 'left', animType: 'sit' },
  13: { dir: 'left', animType: 'sit' },
  19: { dir: 'left', animType: 'sit' },
  29: { dir: 'left', animType: 'sit' },
  24: { dir: 'up', animType: 'stand' },
  4:  { dir: 'up', animType: 'sit' },
  5:  { dir: 'up', animType: 'sit' },
  6:  { dir: 'up', animType: 'sit' },
  7:  { dir: 'up', animType: 'sit' },
  14: { dir: 'up', animType: 'sit' },
  15: { dir: 'up', animType: 'sit' },
}

export function getSeatConfig(id) {
  return SEAT_MAP[id] || { dir: 'down', animType: 'sit' }
}

export const IDLE_SEAT_MAP = {
  18: 'right', 28: 'right', 24: 'dance', 19: 'left', 29: 'left',
}

// Pipeline state → office zone mapping
export const STATE_ZONE_MAP = {
  working:   'desk',
  thinking:  'idle',
  idle:      'idle',
  done:      'idle',
  error:     'desk',
  paused:    'idle',
}

export const STATE_COLORS = {
  idle:      '#94a3b8',
  working:   '#f97316',
  thinking:  '#8b5cf6',
  error:     '#ef4444',
  done:      '#22c55e',
  paused:    '#fbbf24',
}

export let AVATAR_FILES = []

export async function loadAvatarFiles() {
  try {
    const res = await fetch('/shared/avatars.json')
    AVATAR_FILES = await res.json()
  } catch (e) {
    console.error('[OfficeConfig] Failed to load avatars.json')
    AVATAR_FILES = ['avatar_0.webp']
  }
}

export function avatarIndexFromId(id) {
  let hash = 0
  const str = id || ''
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % (AVATAR_FILES.length || 1)
}

export const LAPTOP_ID_MAP = {
  0: 10, 1: 8, 2: 9, 3: 11,
  4: 0, 5: 1, 6: 2, 7: 3,
  8: 12, 9: 14, 10: 15, 11: 13,
  12: 4, 13: 5, 14: 6, 15: 7,
}

// Our pipeline agents — each gets a fixed avatar, name, and job title
export const PIPELINE_AGENTS = [
  { id: 'agent-ceo',      name: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_AGENCY_OWNER_NAME) || 'The Owner', title: 'Chief Executive',         avatar: 0, queue: null },
  { id: 'agent-finance',  name: 'Nina Okonkwo',  title: 'Finance Director',        avatar: 7, queue: null },
  { id: 'agent-scout',    name: 'Maya Chen',      title: 'Lead Scout',              avatar: 1, queue: null },
  { id: 'agent-verify',    name: 'James Okafor',    title: 'Compliance Analyst',      avatar: 2, queue: 'verify' },
  { id: 'agent-copywrite', name: 'Lena Kovacs',    title: 'Copywriter',              avatar: 5, queue: 'copywrite' },
  { id: 'agent-build',     name: 'Priya Sharma',   title: 'Web Developer',           avatar: 3, queue: 'build' },
  { id: 'agent-seo',       name: 'Dani Ortega',    title: 'SEO Specialist',          avatar: 6, queue: 'seo' },
  { id: 'agent-review',    name: 'Chris Nakamura', title: 'Code Reviewer',           avatar: 4, queue: 'review' },
  { id: 'agent-deploy',    name: 'Tom Walsh',      title: 'DevOps Engineer',         avatar: 7, queue: 'deploy' },
  { id: 'agent-call',      name: 'Alex Cooper',    title: 'Business Development',    avatar: 5, queue: 'call' },
  { id: 'agent-followup',  name: 'Sophie Laurent', title: 'Client Relations',        avatar: 6, queue: 'followup' },
  { id: 'agent-close',     name: 'Marcus Reid',    title: 'Sales Director',          avatar: 0, queue: 'close' },
  { id: 'agent-monitor',   name: 'Ava Lindström',  title: 'Lead Monitor',            avatar: 2, queue: null },
  { id: 'agent-deliver',   name: 'Zara Hussain',   title: 'Project Manager',         avatar: 1, queue: null },
  { id: 'agent-max',       name: 'Max',            title: 'Office Dog',               avatar: 8, queue: null },
]
