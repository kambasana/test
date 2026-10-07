// One place to rename the product.
export const PRODUCT_NAME = 'Elenta Office';

// Eight muted department hues, chosen to read on the dark floor and stay
// distinct from the status colours (live teal, waiting amber, refused red).
export const DEPT_PALETTE = [
  '#C9A227', // gold
  '#6A9FD8', // steel blue
  '#7DB98A', // sage
  '#B58BD9', // violet
  '#D58E6F', // terracotta
  '#8FA6B8', // slate
  '#C97FA6', // rose
  '#A3B35F', // olive
];

export const STATUS = {
  live: '#2DD4BF',
  waiting: '#F5A524',
  error: '#F87171',
  idle: '#5C6878',
};

export const JOB_STATES = [
  'queued', 'routing', 'planning', 'working', 'combining',
  'waiting_approval', 'done', 'failed', 'rejected', 'cancelled',
];

export const TERMINAL_STATES = new Set(['done', 'failed', 'rejected', 'cancelled']);

export const STATE_LABEL = {
  queued: 'QUEUED',
  routing: 'ROUTING',
  planning: 'PLANNING',
  working: 'WORKING',
  combining: 'COMBINING',
  waiting_approval: 'NEEDS APPROVAL',
  done: 'DONE',
  failed: 'FAILED',
  rejected: 'REJECTED',
  cancelled: 'CANCELLED',
};

// Visual tone for a job or piece state: live | waiting | error | done | idle
export function stateTone(state) {
  switch (state) {
    case 'routing': case 'planning': case 'working': case 'combining':
    case 'running': case 'started':
      return 'live';
    case 'waiting_approval': return 'waiting';
    case 'failed': case 'rejected': case 'error': return 'error';
    case 'done': return 'done';
    default: return 'idle';
  }
}
