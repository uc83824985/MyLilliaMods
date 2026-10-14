using BepInEx.Unity.IL2CPP;
using Il2CppInterop.Runtime;
using LilliaChasePrototype;
using UnityEngine;
using UnityEngine.AI;
using Character = ProjectTarkovH.CharacterController;
using Prototype = LilliaChasePrototype.Plugin;

// Measure final transform displacement across real Unity frames, with navigation
// and the installed System root-motion component both active.
public sealed class PursuitFrameProbe : MonoBehaviour
{
    public PursuitFrameProbe(IntPtr pointer) : base(pointer) { }
    private GameObject? parent, targetRoot;
    private PatrolMovement? patrol;
    private Animator? animator;
    private NavMeshAgent? agent;
    private readonly Engine engine = new();
    private NavMeshDataInstance nav;
    private NavMeshData? data;
    private Vector3 previous;
    private float elapsed, distance, expected;
    private int frames;
    private bool finished;
    private bool comparisonComplete;
    private void Setup()
    {
        var sources = new Il2CppSystem.Collections.Generic.List<NavMeshBuildSource>();
        sources.Add(new NavMeshBuildSource { shape = NavMeshBuildSourceShape.Box, size = new Vector3(60, 1, 60),
            transform = Matrix4x4.TRS(new Vector3(600, -.5f, 600), Quaternion.identity, Vector3.one), area = 0 });
        var build = NavMesh.GetSettingsByIndex(0);
        data = NavMeshBuilder.BuildNavMeshData(build, sources, new Bounds(new Vector3(600, 0, 600), new Vector3(60, 10, 60)), Vector3.zero, Quaternion.identity);
        nav = NavMesh.AddNavMeshData(data);
        parent = new GameObject("PursuitFrameActor"); parent.SetActive(false);
        var root = UnityEngine.Object.Instantiate(Checks.Prefabs[0], parent.transform, false);
        foreach (var script in root.GetComponentsInChildren<MonoBehaviour>(true)) script.enabled = false;
        foreach (var collider in root.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
        var owner = root.GetComponent<PoliceStateControl>();
        owner._alertValue = 100; owner.npcTagHolder = root.GetComponent<NPCTagHolder>();
        patrol = root.GetComponent<PatrolMovement>(); patrol._characterControl = owner; owner.patrolMovement = patrol;
        patrol.PatrolStatus = PatrolStatus.Chase;
        var movement = root.GetComponent<NPCMovementController>();
        if (movement != null) { movement.isMovementPaused = false; movement.isInSexState = false; movement.isExhaustionFrozen = false; movement.isVisionFrozen = false; }
        animator = root.GetComponent<Animator>(); owner.anim = animator;
        agent = root.GetComponent<NavMeshAgent>(); owner.agent = patrol.agent = agent;
        agent.enabled = false; root.transform.position = new Vector3(600, 0, 600);
        parent.SetActive(true); agent.agentTypeID = build.agentTypeID; agent.enabled = true; agent.Warp(root.transform.position);
        agent.updateRotation = false; agent.acceleration = 100; agent.stoppingDistance = 0;
        animator.enabled = true; animator.applyRootMotion = true; animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
        animator.Rebind(); animator.SetLayerWeight(owner.runLayerIndex, 1); animator.SetFloat("Speed", 1);
        animator.Update(0);
        targetRoot = new GameObject("PursuitFrameTarget"); targetRoot.SetActive(false);
        var target = targetRoot.AddComponent<Character>(); target.MaxRunSpeed = 4;
        engine.Character = target; engine.CaptureHooksReady = true;
        if (IL2CPPChainloader.Instance.Plugins.TryGetValue("com.yourname.lilliasystem", out var info))
        {
            var type = info.Instance.GetType().Assembly.GetType("ItemSpawnMod.PoliceRootMotion")!;
            var component = root.AddComponent(Il2CppType.From(type));
            // Use the installed component's actual callback, with the same stretch
            // that System configures. Leave the fixture's native AI disabled.
            var typed = typeof(Il2CppInterop.Runtime.InteropTypes.Il2CppObjectBase).GetMethod("Cast")!.MakeGenericMethod(type).Invoke(component, null);
            float global = RunSpeedCompatibility.GlobalMultiplier();
            type.GetField("StrideMultiplier", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
                .SetValue(typed, global / RunSpeedCompatibility.AnimationRate(global));
        }
        engine.ChaseSpeed.Apply(engine, patrol);
        agent.updatePosition = true; // Reproduce the previous competing position writers first.
        expected = 4 * RunSpeedCompatibility.GlobalMultiplier() * Prototype.Options.ChaseSpeedRatio.Value;
        agent.isStopped = false; agent.SetDestination(root.transform.position + Vector3.forward * 25);
        previous = root.transform.position;
    }
    public void LateUpdate()
    {
        if (finished || !Checks.GuiPassed) return;
        try
        {
            if (parent == null) { Setup(); return; }
            engine.ChaseSpeed.Apply(engine, patrol!);
            if (!comparisonComplete) agent!.updatePosition = true;
            Vector3 position = patrol!.transform.position;
            if (++frames > 10) { elapsed += Time.deltaTime; distance += Vector3.ProjectOnPlane(position - previous, Vector3.up).magnitude; }
            previous = position;
            if (elapsed < .7f) return;
            float speed = distance / elapsed;
            if (!comparisonComplete)
            {
                Checks.GuiCheck(float.IsFinite(speed), $"previous dual-writer pursuit speed={speed:F3} target={expected:F3}");
                comparisonComplete = true; elapsed = distance = 0; frames = 0; return;
            }
            Checks.GuiCheck(!agent!.updatePosition && Math.Abs(speed - expected) < expected * .15f,
                $"real Unity pursuit displacement speed={speed:F3} target={expected:F3}; navigation cannot add displacement");
            Cleanup(); Checks.MotionPassed = true;
        }
        catch (Exception ex) { Cleanup(); Checks.GuiFailure(ex); }
    }
    private void Cleanup()
    {
        finished = true; engine.ChaseSpeed.Reset();
        if (parent != null) UnityEngine.Object.Destroy(parent);
        if (targetRoot != null) UnityEngine.Object.Destroy(targetRoot);
        if (nav.valid) nav.Remove(); if (data != null) UnityEngine.Object.Destroy(data);
    }
}
