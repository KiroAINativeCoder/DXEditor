// A throwaway identity for presence until real auth (Phase 4) lands.
const ADJECTIVES = ['Swift', 'Calm', 'Bright', 'Bold', 'Kind', 'Keen', 'Warm', 'Cool']
const ANIMALS = ['Otter', 'Falcon', 'Fox', 'Heron', 'Lynx', 'Wren', 'Ibex', 'Seal']
const COLORS = ['#ff8a3d', '#3d9bff', '#39c07a', '#c05cff', '#ff5c8a', '#f2b705', '#00b3b3', '#e8552d']

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export type Identity = { name: string; color: string }

export function makeIdentity(): Identity {
  return {
    name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`,
    color: pick(COLORS),
  }
}
