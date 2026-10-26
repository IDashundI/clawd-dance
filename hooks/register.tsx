import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Beat } from '../types'

const PANE = 'clawd-dance'
const TITLE = 'Клодик'
const TICK_MS = 200

const beat = atom({ plugin: 'clawd-dance', key: 'beat' } as const, 0 as Beat)
const isBusy = atom({ plugin: 'clawd-dance', key: 'isBusy' } as const, false)

// Clawd is drawn on a pixel canvas, two pixels per cell each way, so every
// pixel is one quadrant of a block character, as in the logo itself. Poses are
// drawn in units of half a logo pixel (the body is 24 x 8 units, arms and legs
// added per pose), then every unit becomes SCALE x SCALE pixels, the same on
// both axes, so Clawd grows to fill the pane and keeps the logo's proportions.
const W = 48
const H = 18
const MAX_SCALE = 8
// Rows the pane draws besides Clawd: the notes, the floor and the caption.
const EXTRA_ROWS = 3
const BODY_W = 24
const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'

type Arm = 'down' | 'low' | 'out' | 'up' | 'high'
type Legs = 'stand' | 'left' | 'right' | 'wide' | 'tuck'
type Eyes = 'open' | 'left' | 'right' | 'blink' | 'wink'

type Pose = {
  x?: number // sway, in pixels
  y?: number // hop, in pixels (negative is up)
  l?: Arm
  r?: Arm
  legs?: Legs
  eyes?: Eyes
  squash?: boolean
}

// Left arm shapes as [x0, x1, y0, y1] rectangles relative to the body's
// top-left corner; the right arm mirrors them.
const ARMS: Record<Arm, number[][]> = {
  down: [[-4, -1, 4, 5]],
  low: [[-2, -1, 4, 5], [-4, -3, 6, 7]],
  out: [[-6, -1, 3, 4]],
  up: [[-2, -1, 4, 5], [-4, -3, 2, 3], [-6, -5, 0, 1]],
  high: [[-2, -1, 3, 4], [-3, -2, 1, 2], [-3, -2, -1, 0], [-3, -2, -3, -2]],
}

// Legs as [x, height] pairs below the body, left pair then right pair.
const LEGS: Record<Legs, number[][]> = {
  stand: [[2, 2], [6, 2], [16, 2], [20, 2]],
  left: [[2, 1], [6, 1], [16, 2], [20, 2]],
  right: [[2, 2], [6, 2], [16, 1], [20, 1]],
  wide: [[0, 2], [5, 2], [17, 2], [22, 2]],
  tuck: [[3, 1], [7, 1], [15, 1], [19, 1]],
}

const draw = (pose: Pose): boolean[][] => {
  const px: boolean[][] = Array.from({ length: H }, () => Array(W).fill(false))
  const fill = (x0: number, x1: number, y0: number, y1: number, on = true) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const row = px[y]
        if (row && x >= 0 && x < W) row[x] = on
      }
    }
  }

  const bx = 12 + (pose.x ?? 0)
  const top = 8 + (pose.y ?? 0) + (pose.squash ? 2 : 0)
  const bottom = 8 + (pose.y ?? 0) + 7
  const armDrop = pose.squash ? 1 : 0

  fill(bx, bx + BODY_W - 1, top, bottom)

  // Eyes are holes in the body.
  const eyeY = top + 2
  const look = pose.eyes === 'left' ? -1 : pose.eyes === 'right' ? 1 : 0
  for (const [side, ex] of [['l', 4], ['r', 18]] as const) {
    const isShut = pose.eyes === 'blink' || (pose.eyes === 'wink' && side === 'r')
    fill(bx + ex + look, bx + ex + look + 1, isShut ? eyeY + 1 : eyeY, eyeY + 1, false)
  }

  for (const [x0, x1, y0, y1] of ARMS[pose.l ?? 'down']) {
    fill(bx + x0!, bx + x1!, top - (pose.squash ? 2 : 0) + y0! + armDrop, top - (pose.squash ? 2 : 0) + y1! + armDrop)
  }
  for (const [x0, x1, y0, y1] of ARMS[pose.r ?? 'down']) {
    fill(bx + BODY_W - 1 - x1!, bx + BODY_W - 1 - x0!, top - (pose.squash ? 2 : 0) + y0! + armDrop, top - (pose.squash ? 2 : 0) + y1! + armDrop)
  }

  for (const [lx, height] of LEGS[pose.legs ?? 'stand']) {
    fill(bx + lx!, bx + lx! + 1, bottom + 1, bottom + height!)
  }

  return px
}

// Packs a pose's units into block characters, each unit SCALE pixels across.
const pack = (px: boolean[][], scale: number): string[] => {
  const on = (x: number, y: number) => px[Math.floor(y / scale)]?.[Math.floor(x / scale)] ?? false
  const rows: string[] = []
  for (let y = 0; y < H * scale; y += 2) {
    let line = ''
    for (let x = 0; x < W * scale; x += 2) {
      const bits = (on(x, y) ? 1 : 0) | (on(x + 1, y) ? 2 : 0) | (on(x, y + 1) ? 4 : 0) | (on(x + 1, y + 1) ? 8 : 0)
      line += QUADRANTS[bits]
    }
    rows.push(line)
  }

  return rows
}

// The largest scale whose drawing fits in the pane's body.
const fit = (columns: number, rows: number): number => {
  let scale = 1
  while (scale < MAX_SCALE && (W / 2) * (scale + 1) <= columns && (H / 2) * (scale + 1) + EXTRA_ROWS <= rows) scale++

  return scale
}

// The choreography, one pose per beat.
const DANCE: Pose[] = [
  // bob in place
  {}, { squash: true, legs: 'tuck' }, {}, { y: -2, l: 'low', r: 'low' },
  {}, { eyes: 'blink' }, {}, { squash: true, legs: 'tuck', eyes: 'blink' },
  // wave the left arm
  { l: 'up' }, { l: 'high', eyes: 'left' }, { l: 'up', eyes: 'left' }, { l: 'high', eyes: 'left' },
  // wave the right arm
  { r: 'up' }, { r: 'high', eyes: 'right' }, { r: 'up', eyes: 'right' }, { r: 'high', eyes: 'right' },
  // step to the left
  { x: -2, legs: 'left', l: 'out', eyes: 'left' }, { x: -4, legs: 'right', l: 'low', r: 'out', eyes: 'left' },
  { x: -6, legs: 'left', l: 'out', eyes: 'left' }, { x: -6, squash: true, legs: 'wide', l: 'low', r: 'low' },
  // and back to the right
  { x: -4, legs: 'right', r: 'out', eyes: 'right' }, { x: -2, legs: 'left', l: 'out', r: 'low', eyes: 'right' },
  { x: 0, legs: 'right', r: 'out', eyes: 'right' }, { x: 2, legs: 'left', l: 'out', eyes: 'right' },
  { x: 4, legs: 'right', r: 'out', eyes: 'right' }, { x: 6, squash: true, legs: 'wide', l: 'low', r: 'low' },
  { x: 4, legs: 'left', l: 'out', eyes: 'left' }, { x: 2, legs: 'right', r: 'out', eyes: 'left' },
  // disco: one arm up, one down, switching
  { x: 0, l: 'high', r: 'low', legs: 'left' }, { x: 0, l: 'low', r: 'high', legs: 'right' },
  { x: 0, l: 'high', r: 'low', legs: 'left', eyes: 'wink' }, { x: 0, l: 'low', r: 'high', legs: 'right', eyes: 'wink' },
  // crouch and jump with both arms up
  { squash: true, legs: 'wide', l: 'low', r: 'low' }, { y: -3, legs: 'tuck', l: 'up', r: 'up' },
  { y: -5, legs: 'tuck', l: 'high', r: 'high', eyes: 'blink' }, { y: -3, legs: 'tuck', l: 'up', r: 'up' },
  { squash: true, legs: 'wide', l: 'out', r: 'out' }, {},
  // shimmy: arms out, wiggling
  { x: -2, l: 'out', r: 'out', legs: 'left' }, { x: 2, l: 'out', r: 'out', legs: 'right' },
  { x: -2, l: 'out', r: 'out', legs: 'left' }, { x: 2, l: 'out', r: 'out', legs: 'right' },
  // bow
  { squash: true, l: 'low', r: 'low', eyes: 'blink' }, { squash: true, l: 'low', r: 'low', eyes: 'blink' }, {}, { eyes: 'wink', r: 'up' },
]

const POSES = DANCE.map(draw)
const FRAMES = new Map<number, string[][]>()
const framesAt = (scale: number): string[][] => {
  let frames = FRAMES.get(scale)
  if (!frames) {
    frames = POSES.map(px => pack(px, scale))
    FRAMES.set(scale, frames)
  }

  return frames
}

// Asked of the dock and the inline block alike; each surface caps it.
const OPEN = { id: PANE, title: TITLE, columns: 96, rows: 40 }

const NOTES = ['♪', '♫', '♬', '♩']

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'dance',
      description: 'Открыть панель, где танцует Клодик',
    })
    void $.ui.open(OPEN)

    // Busy turns dance every tick, idle ones every other tick.
    let tick = 0
    $.clock.every(TICK_MS, async () => {
      tick += 1
      if ((await read($, isBusy)) || tick % 2 === 0) {
        await update($, beat, n => (n + 1) % 100000)
      }
    })

    return next(e)
  })

  on('command.run', { command: 'dance' }, async $ => {
    await $.ui.open(OPEN)

    return { text: 'Клодик вышел на танцпол 💃' }
  })

  on('prompt.submit', async ($, e, next) => {
    // Never hold up a prompt over a dance move.
    void update($, isBusy, () => true).catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    void update($, isBusy, () => false).catch(() => undefined)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const n = await read($, beat)
    const busy = await read($, isBusy)
    const scale = fit(e.props.bodyColumns, e.props.scroll.bodyRows)
    const width = (W / 2) * scale
    const frames = framesAt(scale)
    const frame = frames[n % frames.length] ?? frames[0]!
    const note = NOTES[Math.floor(n / 2) % NOTES.length]!
    const notePos = [2, 7, 15, 20][Math.floor(n / 2) % 4]! * scale
    const noteLine = ' '.repeat(notePos) + note + ' '.repeat(width - notePos - 1)

    return (
      <Box flexDirection="column">
        <Text color="suggestion">{noteLine}</Text>
        {frame.map(row => (
          <Text color="claude">{row}</Text>
        ))}
        <Text dimColor>{'▔'.repeat(width)}</Text>
        <Text dimColor>{busy ? 'работаю и танцую!' : 'танцую, пока ждём'}</Text>
      </Box>
    )
  })
}
