// Presentation reads confirmed events; being inside the perfect timing window is not success.
export function perfectCue(world) {
  const event = world.events.findLast(e => e.type === 'perfect');
  if (!event) return null;
  const age = world.time - event.t;
  if (age < -.001 || age >= .9) return null;
  return { x:event.x ?? world.player.x, y:event.y ?? world.player.y, refund:event.refund, progress:Math.max(0,age)/.9 };
}
