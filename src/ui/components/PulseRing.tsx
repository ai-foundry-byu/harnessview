// Small embeddable pulse ring for use INSIDE a React Flow custom node.
// Inherits the node's transform — never desyncs on re-layout (unlike the
// old absolute-DOM overlay).
//
// Color + cadence reflect node status:
//   active : neon cyan, fast pulse
//   idle   : slate, slow gentle pulse
//   stale  : amber, slow
//   error  : magenta, fast urgent
//   unknown: dim, no pulse
//
// Size defaults to 10px dot — sits in a node corner. Colors come from the
// shared STATUS_TONE palette in @core/styles; only the cadence is local.

import { motion } from 'framer-motion';
import type { NodeStatus } from '@core/types';
import { STATUS_TONE } from '@core/styles';

const CADENCE_SEC: Record<NodeStatus, number> = {
  active: 1.2,
  idle: 3.5,
  stale: 3.0,
  error: 0.8,
  unknown: 0, // no animation
};

export default function PulseRing({
  status,
  size = 10,
}: {
  status: NodeStatus;
  size?: number;
}) {
  const color = STATUS_TONE[status];
  const cadence = CADENCE_SEC[status];

  if (cadence === 0) {
    return (
      <div
        aria-label={`status-${status}`}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: color,
          opacity: 0.4,
        }}
      />
    );
  }

  return (
    <div
      aria-label={`status-${status}`}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size * 2,
        height: size * 2,
      }}
    >
      <motion.div
        animate={{ scale: [1, 1.9, 1], opacity: [0.55, 0, 0.55] }}
        transition={{ duration: cadence, repeat: Infinity, ease: 'easeOut' }}
        style={{
          position: 'absolute',
          pointerEvents: 'none',
          borderRadius: '50%',
          width: size * 1.8,
          height: size * 1.8,
          border: `1px solid ${color}`,
        }}
      />
      <motion.div
        animate={{ scale: [1, 1.15, 1], opacity: [0.95, 0.7, 0.95] }}
        transition={{ duration: cadence, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          borderRadius: '50%',
          width: size,
          height: size,
          background: color,
          boxShadow: `0 0 8px ${color}`,
        }}
      />
    </div>
  );
}
