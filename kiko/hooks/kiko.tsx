import type { ClientModule, ClientSurface } from 'claude-code'

import type { Round } from '../types'
import { BEAT_FRAMES, FRAME_MS, koCard, layout } from './sprites'

type Props = Round & { columns: number; maxRows: number }
type Local = { frame: number; beatId: number; beatStart: number }

const Kiko: ClientModule = (raw, surface) => {
  const props = raw as unknown as Props
  const s = surface as ClientSurface<Local>
  const { Box, Text } = s.elements
  if (s.state === undefined) {
    s.setState({ frame: 0, beatId: props.beat?.id ?? -1, beatStart: 0 })
    s.every(FRAME_MS, () => {
      const cur = s.state
      if (cur) s.setState({ ...cur, frame: cur.frame + 1 })
    })
  }
  const local = s.state ?? { frame: 0, beatId: props.beat?.id ?? -1, beatStart: 0 }
  let { beatId, beatStart } = local
  if (props.beat && props.beat.id !== beatId) {
    beatId = props.beat.id
    beatStart = local.frame
    s.setState({ ...local, beatId, beatStart })
  }
  const step = props.beat && props.beat.id === beatId ? local.frame - beatStart : null
  const beatStep = step !== null && step < BEAT_FRAMES ? step : null
  const columns = Math.max(20, props.columns || s.columns || 80)
  const rows = props.phase === 'ko'
    ? koCard(props, columns)
    : layout(props, { frame: local.frame, beatStep, now: Date.now() }, columns, props.maxRows ?? 6)
  return (
    <Box flexDirection="column">
      {rows.map(row => <Text>{row}</Text>)}
    </Box>
  )
}

export default Kiko
