// React Flow node-type registry.
//
// Node kinds are dynamic strings (adapter-supplied), so — unlike the old
// per-tier map — there is exactly ONE node component. Every React Flow node
// is given `type: 'hv'`; BaseNode reads the real kind from `data.kind` and its
// resolved style from `data.kindStyle` (injected by Graph).

import BaseNode from './BaseNode';

export const NODE_TYPES = {
  hv: BaseNode,
} as const;
