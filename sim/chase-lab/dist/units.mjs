// Spatial calibration relative to the previously verified ×2 experiments.
// Durations, angles, stamina and dimensionless multipliers are unchanged.
export const BASE = Object.freeze({ nativeRunSpeed: 3.143, globalScale: 1.5, nativeWalkSpeed: .8197, globalWalkScale: 3, dt: 1 / 120 });
export const RUN = BASE.nativeRunSpeed * BASE.globalScale;
// Independently sampled root motion and the game's separate walking multiplier.
export const WALK = BASE.nativeWalkSpeed * BASE.globalWalkScale;
export const WALK_SCALE = WALK / RUN;
export const SPACE_SCALE = BASE.globalScale / 2;
export const metres = previous => previous * SPACE_SCALE;
export const STREET_LENGTH_SCALE = 1.5;
export const MIRROR_STREET_SHIFT = RUN * 2 * 1.8 * (STREET_LENGTH_SCALE - 1);
// Keep mirror pair geometry and its lateral position within the northern road.
export const mirrorY = previous => metres(previous) - MIRROR_STREET_SHIFT;
