// Display legal sensor results, never infer hearing merely from pursuit or proximity.
export function perceptionCue(world) {
  const e=world.police;
  const heard=!!world.config.search && !!e.lastHeard && world.time-e.lastHeard.t<world.config.search.soundInterval;
  return {eye:world.config.practice?'inactive':e.visible?'visible':e.search?'searching':'lost',ear:heard?'heard':'quiet'};
}
export function playerCue(world) {
  const p=world.player,phase=world.phase();
  return {
    movement:phase==='ready'?(p.locomotion??'idle'):phase,
    stealth:!world.config.stealth?'unavailable':world.invisible()?'active':world.time<(p.stealthReadyAt??0)?'cooldown':'ready',
    remaining:world.invisible()?p.invisibleUntil-world.time:Math.max(0,(p.stealthReadyAt??0)-world.time),
    uses:p.stealthUses??0
  };
}
