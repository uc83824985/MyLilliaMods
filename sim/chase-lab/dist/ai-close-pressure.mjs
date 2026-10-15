// Only public position/animation and elapsed time enter this process. No opponent stamina or policy.
export function advanceClosePressure(spec, state, observation, rng) {
  if (!spec) return { state, allowed: true };
  const s = state ?? { enteredAt: null, dodgeAt: null, walkSince: null };
  const { now, visible, distance, phase, speed, walkSpeed, inReach } = observation;
  let started = false, noticedDodge = false, noticedWalk = false;
  if (visible && distance <= spec.closeRange && s.enteredAt === null) {
    s.enteredAt = now; s.until = now + rng.range(spec.min, spec.max); started = true;
  }
  if (visible && distance <= spec.observeRange && ['startup', 'dash'].includes(phase) && s.dodgeAt === null) {
    s.dodgeAt = now; s.dodgeReactAt = now + Math.max(.05, rng.normal(spec.reaction, spec.jitter)); noticedDodge = true;
  }
  // Slow motion alone is meaningful only outside dodge/recovery. Standing still counts too.
  const slow = s.enteredAt !== null && visible && distance <= spec.observeRange && phase === 'ready' && speed <= walkSpeed + .15;
  if (!slow) s.walkSince = null;
  else if (s.walkSince === null) s.walkSince = now;
  if (spec.respondToWalk && slow && now - s.walkSince >= spec.walkConfirm && s.walkReactAt === undefined) {
    s.walkReactAt = now + Math.max(.05, rng.normal(spec.reaction, spec.jitter)); noticedWalk = true;
  }
  const reason = s.dodgeReactAt !== undefined && now >= s.dodgeReactAt ? 'dodge' :
    s.walkReactAt !== undefined && now >= s.walkReactAt ? 'walking' :
    s.until !== undefined && now >= s.until ? 'deadline' : null;
  const allowed = visible && inReach && reason !== null;
  const released = allowed && s.releaseReason === undefined;
  if (released) s.releaseReason = reason;
  return { state: s, allowed, started, noticedDodge, noticedWalk, released, reason };
}
