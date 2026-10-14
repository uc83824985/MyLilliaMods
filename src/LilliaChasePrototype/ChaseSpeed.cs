using UnityEngine;
using UnityEngine.AI;

namespace LilliaChasePrototype;

// Own only normal pursuit. Attack motion has its own timing and movement authority.
internal sealed class ChaseSpeed
{
    private sealed class State
    {
        internal Animator Animator = null!;
        internal PatrolMovement Patrol = null!;
        internal NavMeshAgent? Agent;
        internal float NativeRun, OriginalAnimation, AppliedAnimation, OriginalAgent, AppliedAgent;
        internal bool OriginalUpdatePosition, OwnsPosition;
    }
    private readonly Dictionary<long, State> states = new();
    private long playerId;
    private readonly DodgeAnimation playerProbe = new();

    internal void Apply(Engine engine, PatrolMovement patrol)
    {
        var owner = patrol._characterControl ?? patrol.GetComponent<DefaultCharacterControl>();
        if (owner == null) return;
        long id = owner.Pointer.ToInt64();
        var police = engine.Police.TryGetValue(id, out var registered) ? registered : new Police(owner);
        var movement = police.Movement;
        if (!engine.CaptureEnabled || engine.Character == null || patrol.PatrolStatus != PatrolStatus.Chase || !police.Chasing || police.Incapacitated ||
            owner.isCoroutineRunning || engine.Captures.ContainsKey(id) ||
            movement?.IsInSexState == true || movement?.IsMovementPaused == true ||
            movement?.IsExhaustionFrozen == true || movement?.IsVisionFrozen == true)
        { Restore(id); return; }
        var animator = owner.anim ?? owner.GetComponent<Animator>();
        if (animator == null) return;
        if (!states.TryGetValue(id, out var state))
        {
            var probe = new DodgeAnimation(); probe.Prepare(animator, patrol.RunSpeed);
            var agent = owner.agent ?? owner.GetComponent<NavMeshAgent>();
            state = new State { Animator = animator, Patrol = patrol, Agent = agent, NativeRun = probe.BaseRunSpeed,
                OriginalAnimation = animator.speed, OriginalAgent = agent != null ? agent.speed : 0,
                OriginalUpdatePosition = agent != null && agent.updatePosition };
            states[id] = state;
        }
        if (playerId != engine.Character.Pointer.ToInt64())
        { playerProbe.Prepare(engine.Character); playerId = engine.Character.Pointer.ToInt64(); }
        float global = RunSpeedCompatibility.GlobalMultiplier();
        float target = playerProbe.BaseRunSpeed * global * Plugin.Options.ChaseSpeedRatio.Value;
        // System stretches the root stride separately from Animator.speed. Compensate
        // for that existing stretch so its global multiplier is counted exactly once.
        float stride = global / RunSpeedCompatibility.AnimationRate(global);
        state.AppliedAnimation = stride > 0 ? target / (state.NativeRun * stride) : 0;
        animator.speed = state.AppliedAnimation;
        if (state.Agent != null)
        {
            state.AppliedAgent = target; state.Agent.speed = target;
            if (animator.applyRootMotion)
            {
                // Navigation steers; root motion is the sole position writer.
                state.OwnsPosition = true; state.Agent.updatePosition = false;
                if (state.Agent.isActiveAndEnabled && state.Agent.isOnNavMesh)
                    state.Agent.nextPosition = owner.transform.position;
            }
            else if (state.OwnsPosition)
            { state.Agent.updatePosition = state.OriginalUpdatePosition; state.OwnsPosition = false; }
        }
    }

    internal void Restore(long id)
    {
        if (!states.Remove(id, out var state)) return;
        if (state.Animator != null && Mathf.Approximately(state.Animator.speed, state.AppliedAnimation))
            state.Animator.speed = state.OriginalAnimation;
        if (state.Agent != null && Mathf.Approximately(state.Agent.speed, state.AppliedAgent))
            state.Agent.speed = state.OriginalAgent;
        if (state.Agent != null && state.OwnsPosition) state.Agent.updatePosition = state.OriginalUpdatePosition;
    }
    internal void Reset()
    { foreach (long id in states.Keys.ToArray()) Restore(id); playerId = 0; }
    internal void Tick(Engine engine)
    {
        foreach (var entry in states.ToArray())
            if (entry.Value.Patrol == null || !entry.Value.Patrol.isActiveAndEnabled) Restore(entry.Key);
            else Apply(engine, entry.Value.Patrol);
    }
}
