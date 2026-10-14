using BepInEx.Unity.IL2CPP;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;
using Character = ProjectTarkovH.CharacterController;

namespace LilliaChasePrototype;

// Read another loaded plugin's public configuration only; no System assembly/type dependency.
internal static class RunSpeedCompatibility
{
    // Match the existing global running animation rule; dodge movement multiplier is excluded.
    internal static float AnimationRate(float globalMultiplier) => Math.Max(1, globalMultiplier / 2);
    internal static float GlobalMultiplier(string key = "RunSpeedMultiplier")
    {
        if (IL2CPPChainloader.Instance != null &&
            IL2CPPChainloader.Instance.Plugins.TryGetValue("com.yourname.lilliasystem", out var info) &&
            info.Instance is BasePlugin plugin &&
            plugin.Config.TryGetEntry<double>("Movement", key, out var entry))
        {
            double value = entry.Value;
            if (double.IsFinite(value) && value >= 0 && value <= 1000) return (float)value;
            Plugin.Log.LogWarning("[Dodge Animation] 全局跑步倍率无效，使用 1。");
        }
        return 1;
    }
}

internal sealed class DodgeAnimation
{
    private static readonly Dictionary<(long Avatar, long Clip, int X, int Y, int Z), float> runRates = new();
    internal static int SamplingCount;
    private PlayableGraph graph;
    private AnimationClipPlayable playable;
    private Animator? animator;
    private Character? character;
    internal AnimationClip? Clip;
    internal float BaseRunSpeed, BaseWalkSpeed, GlobalMultiplier, GlobalWalkMultiplier, PlaybackRate;
    internal float ScaledRunSpeed => BaseRunSpeed * GlobalMultiplier;
    internal bool Active => graph.IsValid();
    internal float PlaybackPhase => Active && Clip != null && Clip.length > 0 ? (float)(playable.GetTime() / Clip.length % 1) : 0;
    internal bool HandoffAligned;
    internal float HandoffPhase;

    internal void Prepare(Character character)
    {
        Prepare(character.anim ?? character.GetComponentInChildren<Animator>(), character.MaxRunSpeed);
        this.character = character;
        var walk = animator?.runtimeAnimatorController?.animationClips.FirstOrDefault(c =>
            string.Equals(c.name, "Walk", StringComparison.OrdinalIgnoreCase) && c.isLooping && c.events.Length == 0);
        float walkRate = walk != null && animator != null ? MeasureRunRate(animator, walk) : 0;
        BaseWalkSpeed = walkRate > .01f && float.IsFinite(walkRate) ? walkRate : character.MaxWalkSpeed;
        GlobalWalkMultiplier = RunSpeedCompatibility.GlobalMultiplier("WalkSpeedMultiplier");
    }

    internal void Prepare(Animator? source, float fallbackRunSpeed)
    {
        Stop(); animator = source; character = null;
        Clip = animator?.runtimeAnimatorController?.animationClips.FirstOrDefault(c =>
            (string.Equals(c.name, "Run", StringComparison.OrdinalIgnoreCase) ||
             string.Equals(c.name, "MCU_am_Loco_Run_01", StringComparison.OrdinalIgnoreCase)) && c.isLooping && c.events.Length == 0);
        // Native grounded locomotion consumes root motion; MaxRunSpeed is only a fallback
        // when a controller supplies no usable running root displacement.
        float clipSpeed = Clip != null && animator != null ? MeasureRunRate(animator, Clip) : 0;
        BaseRunSpeed = clipSpeed > .01f && float.IsFinite(clipSpeed) ? clipSpeed : fallbackRunSpeed;
        if (!float.IsFinite(BaseRunSpeed) || BaseRunSpeed <= .01f) BaseRunSpeed = 3.5f;
        GlobalMultiplier = RunSpeedCompatibility.GlobalMultiplier();
    }

    private static float MeasureRunRate(Animator source, AnimationClip clip)
    {
        var scale = source.transform.lossyScale;
        var key = (source.avatar != null ? source.avatar.Pointer.ToInt64() : 0, clip.Pointer.ToInt64(),
            (int)MathF.Round(scale.x * 10000), (int)MathF.Round(scale.y * 10000), (int)MathF.Round(scale.z * 10000));
        if (runRates.TryGetValue(key, out float cached)) return cached;
        SamplingCount++;
        GameObject? root = null;
        PlayableGraph probeGraph = default;
        try
        {
            // Build transforms only: cloning the player itself would run unrelated Awake/Start
            // handlers. The probe has no scripts, colliders, renderers, or game-state references.
            root = new GameObject("ChasePrototype_RunRateProbe"); root.SetActive(false);
            root.transform.localScale = source.transform.lossyScale;
            void CopyBones(Transform original, Transform parent)
            {
                for (int i = 0; i < original.childCount; i++)
                {
                    var bone = original.GetChild(i);
                    var copy = new GameObject(bone.name).transform; copy.SetParent(parent, false);
                    copy.localPosition = bone.localPosition; copy.localRotation = bone.localRotation; copy.localScale = bone.localScale;
                    CopyBones(bone, copy);
                }
            }
            CopyBones(source.transform, root.transform);
            var probe = root.AddComponent<Animator>(); probe.avatar = source.avatar;
            probe.cullingMode = AnimatorCullingMode.AlwaysAnimate; probe.applyRootMotion = true;
            root.SetActive(true);
            probeGraph = PlayableGraph.Create("ChasePrototype_RunRateSampling");
            probeGraph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
            var clipPlayable = AnimationClipPlayable.Create(probeGraph, clip);
            clipPlayable.SetApplyFootIK(false);
            var output = AnimationPlayableOutput.Create(probeGraph, "SampleRun", probe);
            output.SetSourcePlayable(clipPlayable); probeGraph.Play(); probeGraph.Evaluate(0);
            int steps = Math.Max(2, (int)Math.Ceiling(clip.length / .02f));
            float dt = clip.length / steps; Vector3 delta = Vector3.zero;
            for (int i = 0; i < steps; i++) { probeGraph.Evaluate(dt); delta += probe.deltaPosition; }
            float rate = Vector3.ProjectOnPlane(delta, Vector3.up).magnitude / clip.length;
            if (!float.IsFinite(rate) || rate <= .01f) throw new InvalidOperationException("Run clip produced no usable root displacement");
            runRates[key] = rate;
            Plugin.Log.LogInfo($"[Dodge Animation] measured-native-run={rate:F3} clip={clip.name} avatar={source.avatar?.name} scale={source.transform.lossyScale}; cached");
            return rate;
        }
        catch (Exception ex)
        {
            Plugin.Log.LogWarning("[Dodge Animation] 原生跑速采样失败，使用跑速字段：" + ex.Message);
            return 0;
        }
        finally
        {
            if (probeGraph.IsValid()) probeGraph.Destroy();
            if (root != null) UnityEngine.Object.Destroy(root);
        }
    }

    internal void Play(int number)
    {
        if (Active || animator == null || Clip == null)
        {
            if (!Active) Plugin.Log.LogWarning($"[Dodge Animation #{number}] 跑步动画不可用，保留原生表现；位移仍生效。");
            return;
        }
        PlaybackRate = RunSpeedCompatibility.AnimationRate(GlobalMultiplier);
        HandoffAligned = false;
        try
        {
            float startPhase = 0;
            if (character != null && character.IsRunning)
                for (int layer = 0; layer < animator.layerCount; layer++)
                    if (animator.GetCurrentAnimatorClipInfo(layer).Any(info => info.clip != null && info.clip.Pointer == Clip.Pointer && info.weight > .5f))
                    { startPhase = animator.GetCurrentAnimatorStateInfo(layer).normalizedTime % 1; break; }
            graph = PlayableGraph.Create("ChasePrototype_DodgeRun");
            graph.SetTimeUpdateMode(DirectorUpdateMode.GameTime);
            playable = AnimationClipPlayable.Create(graph, Clip);
            playable.SetApplyFootIK(true);
            playable.SetTime(startPhase * Clip.length);
            playable.SetSpeed(PlaybackRate);
            var output = AnimationPlayableOutput.Create(graph, "DodgeRun", animator);
            output.SetSourcePlayable(playable);
            graph.Play();
            // Prime the seek at zero delta time so the first moving frame does not
            // treat the skipped fraction of the loop as new root displacement.
            if (character != null)
            {
                graph.Evaluate(0);
                character._pendingRootMotionLocalDelta = Vector3.zero;
            }
            Plugin.Log.LogInfo($"[Dodge Animation #{number}] clip={Clip.name} global-run-scale={GlobalMultiplier:F3} normal-run-clip-rate={PlaybackRate:F3}; dodge multiplier excluded; Animator.speed unchanged");
        }
        catch (Exception ex)
        {
            Stop(); Plugin.Log.LogWarning("[Dodge Animation] 播放失败，恢复原生动画：" + ex);
        }
    }

    internal void Stop(bool alignRunning = false)
    {
        if (!graph.IsValid()) return;
        float phase = PlaybackPhase;
        bool running = alignRunning && animator != null && Clip != null && character != null &&
            character.IsRunning && character._movementEnabled && !character.DoingSex &&
            Vector3.ProjectOnPlane(character._moveInputVector, Vector3.up).sqrMagnitude > .0001f;
        graph.Destroy();
        if (!running) return;
        try
        {
            // Use the loop position rather than resetting the native Run state to frame 0.
            // Do not seek native actions when walking, stopped, cancelled or doing sex.
            for (int layer = 0; layer < animator!.layerCount; layer++)
                foreach (string state in new[] { "Run", "Base Layer.Run" })
                {
                    int hash = Animator.StringToHash(state);
                    if (!animator.HasState(layer, hash)) continue;
                    animator.Play(hash, layer, phase); animator.Update(0);
                    HandoffAligned = true; HandoffPhase = phase;
                    Plugin.Log.LogInfo($"[Dodge Animation] native-run handoff layer={layer} phase={phase:F3} frame={phase * Clip!.length * Clip.frameRate:F1}; Animator.speed unchanged");
                    return;
                }
            Plugin.Log.LogInfo("[Dodge Animation] native Run state unavailable for phase alignment; original controller resumed");
        }
        catch (Exception ex) { Plugin.Log.LogWarning("[Dodge Animation] 跑动相位对齐失败，保留原生恢复：" + ex.Message); }
    }
    internal void Pause(bool paused) { if (Active) playable.SetSpeed(paused ? 0 : PlaybackRate); }

    // Evaluate only from the isolated runtime checks; normal playback follows Unity game time.
    internal void Evaluate(float dt) { if (Active) graph.Evaluate(dt); }
}
