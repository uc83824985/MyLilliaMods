using HarmonyLib;
using ProjectTarkovH;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using Character = ProjectTarkovH.CharacterController;

namespace LilliaChasePrototype;

internal sealed class Police
{
    internal readonly DefaultCharacterControl Owner;
    internal readonly PoliceStateControl? Ordinary;
    internal readonly SeduciblePoliceControl? Seducible;
    internal readonly NPCStateControl? Chief;
    internal readonly long Id;
    internal Police(DefaultCharacterControl owner)
    {
        Owner = owner; Ordinary = owner.TryCast<PoliceStateControl>(); Seducible = owner.TryCast<SeduciblePoliceControl>();
        var tag = owner.npcTagHolder ?? owner.GetComponent<NPCTagHolder>();
        if (Ordinary == null && Seducible == null && tag != null && tag.npcType == NPCType.PoliceChief)
            Chief = owner.TryCast<NPCStateControl>();
        Id = owner.Pointer.ToInt64();
    }
    internal bool Chasing => Ordinary != null ? Ordinary.IsChasing : Seducible != null ? Seducible.IsChasing :
        Chief != null && Owner.patrolMovement != null && Owner.patrolMovement.PatrolStatus == PatrolStatus.Chase;
    internal bool Incapacitated => Ordinary != null ? Ordinary.IsIncapacitated || Ordinary.IsPepperSprayed :
        Seducible != null ? Seducible.IsIncapacitated || Seducible.IsPepperSprayed : Chief == null || Chief.IsExhausted || Chief.doingSex;
    internal NPCMovementController? Movement => Ordinary != null ? Ordinary._movementController : Seducible != null ?
        Seducible._movementController : Owner.GetComponent<NPCMovementController>();
    internal Il2CppSystem.Action? Punishment => Ordinary != null ? Ordinary.OnPunishment : Seducible?.OnPunishment;
    internal bool HasArrest => Punishment != null || (Chief != null && Plugin.Engine.World != null);
    internal void Arrest()
    {
        var callback = Punishment;
        if (callback != null) callback.Invoke();
        else if (Chief != null && Plugin.Engine.World != null) Plugin.Engine.World.Player_OnPunishment();
    }
}

internal sealed class CaptureAction
{
    internal Police Police = null!;
    internal Character Target = null!;
    internal CaptureSettings Settings;
    internal CapturePhase Phase;
    internal int Number;
    internal float Elapsed, RecoveryElapsed;
    internal Vector3 Direction;
    internal Quaternion Rotation;
    internal Animator? Animator;
    internal NavMeshAgent? Agent;
    internal bool WasRootMotion, WasStopped, WasAgentRotation, WasAnimatorEnabled, WasKeepAnimatorState;
    internal readonly Dictionary<int, float> LayerWeights = new();
    internal int OriginalState;
    internal float OriginalTime;
    internal bool AnimationPlayed;
    internal readonly Presentation Visual = new();
}

internal sealed class NativeScope
{
    internal DefaultCharacterControl Owner = null!;
    internal double Original;
    internal bool Restored;
    internal void Restore() { if (Restored) return; Restored = true; if (Owner != null) Owner.catchDistance = Original; }
}

internal sealed class StaminaScope
{
    internal PlayerDirector Director = null!;
    internal float Run, Recover;
    internal bool Restored;
    internal void Restore(bool final = false)
    {
        if (Restored && !final) return; Restored = true;
        if (Director != null) { Director.runStamina = Run; Director.recoverStamina = Recover; }
    }
}

internal sealed class Engine
{
    internal readonly Dictionary<long, CaptureAction> Captures = new();
    internal readonly Dictionary<long, Police> Police = new();
    internal Character? Character;
    internal PlayerDirector? Director;
    internal WorldController? World;
    internal DodgePhase DodgePhase;
    internal DodgeSettings DodgeSettings;
    internal float DodgeElapsed;
    internal Vector3 DodgeDirection;
    internal int DodgeNumber;
    internal bool ProtectionUsed;
    internal bool CaptureHooksReady, DodgeHooksReady;
    internal string LastStatus = "就绪";
    internal readonly Presentation DodgeVisual = new();
    internal readonly DodgeAnimation DodgeAnimation = new();
    private int nextAction;
    private float nextScan, nextSample;
    private long worldId, characterId;
    private bool arrestCommitted;
    private Vector3 dodgeOrigin;
    private readonly Dictionary<long, float> lastRejection = new();
    private static Engine Self => Plugin.Engine;
    private static Settings Options => Plugin.Options;

    internal void Install(Harmony harmony)
    {
        // Each module installs transactionally; no half-suppressed native arrests.
        try
        {
            foreach (Type type in new[] { typeof(PoliceStateControl), typeof(SeduciblePoliceControl) })
                Hook(type, "CheckAlertCost", nameof(AlertPrefix), nameof(AlertPostfix), nameof(AlertFinalizer));
            Hook(typeof(PatrolMovement), "Update", nameof(PatrolPrefix));
            Hook(typeof(PatrolMovement), "UpdateChaseMovement", nameof(PatrolPrefix));
            Hook(typeof(PatrolMovement), "SetWalkSpeed", nameof(PatrolPrefix));
            Hook(typeof(DefaultCharacterControl), "SetSpeedStatus", nameof(SpeedStatusPrefix));
            CaptureHooksReady = true;
        }
        catch { harmony.UnpatchSelf(); throw; }
        Hook(typeof(Character), "UpdateVelocity", null, nameof(VelocityPostfix));
        Hook(typeof(Character), "UpdateRotation", null, nameof(RotationPostfix));
        Hook(typeof(PlayerDirector), "CheckStaminaStatus", nameof(StaminaPrefix), nameof(StaminaPostfix), nameof(StaminaFinalizer));
        Hook(typeof(PlayerDirector), "HandleCharacterInput", nameof(InputPrefix));
        Hook(typeof(PlayerDirector), "HandleCameraInput", nameof(CameraInputPrefix));
        Hook(typeof(WorldController), "Player_OnPunishment", nameof(PunishmentPrefix));
        DodgeHooksReady = true;

        void Hook(Type type, string method, string? prefix = null, string? postfix = null, string? finalizer = null)
        {
            var target = AccessTools.Method(type, method) ?? throw new MissingMethodException(type.FullName, method);
            HarmonyMethod? Patch(string? name) => name == null ? null : new HarmonyMethod(typeof(Engine), name);
            var before = Patch(prefix); var after = Patch(postfix); var finish = Patch(finalizer);
            // Run after other velocity modifiers; no dependency on a particular mod's types.
            if (after != null && method == "UpdateVelocity") after.priority = Priority.Last;
            if (method == "CheckStaminaStatus")
            {
                if (before != null) before.priority = Priority.First;
                if (after != null) after.priority = Priority.Last;
                if (finish != null) finish.priority = Priority.Last;
            }
            harmony.Patch(target, prefix: before, postfix: after, finalizer: finish);
            Plugin.Log.LogInfo("[Hook] " + type.FullName + "." + method);
        }
    }

    internal bool CaptureEnabled => Options.Enabled.Value && Options.CaptureEnabled.Value && CaptureHooksReady;
    private static bool AlertPrefix(DefaultCharacterControl __instance, out NativeScope? __state)
    {
        __state = null;
        if (!Self.CaptureEnabled) return true;
        __state = new NativeScope { Owner = __instance, Original = __instance.catchDistance };
        __instance.catchDistance = 0d;
        return true;
    }
    private static void AlertPostfix(DefaultCharacterControl __instance, NativeScope? __state)
    {
        __state?.Restore();
        if (Self.CaptureEnabled && Self.Character != null && __instance != null)
            Self.Register(__instance);
    }
    private static Exception? AlertFinalizer(NativeScope? __state, Exception? __exception)
    { __state?.Restore(); return __exception; }
    private static bool PatrolPrefix(PatrolMovement __instance)
        => !Self.Holding(__instance._characterControl ?? __instance.GetComponent<DefaultCharacterControl>());
    private static bool SpeedStatusPrefix(DefaultCharacterControl __instance) => !Self.Holding(__instance);
    private bool Holding(DefaultCharacterControl? owner) => owner != null && Captures.ContainsKey(owner.Pointer.ToInt64());
    private static bool InputPrefix(PlayerDirector __instance)
    {
        if (!RuntimeHost.PanelOpen) return true;
        if (__instance.Character != null)
        {
            var input = new PlayerCharacterInputs { CameraRotation = __instance.Character.transform.rotation };
            __instance.Character.SetInputs(ref input);
        }
        return false;
    }
    private static bool CameraInputPrefix() => !RuntimeHost.PanelOpen;
    private static void PunishmentPrefix() { Self.arrestCommitted = true; Self.StopDodge("native-arrest"); }
    private static void StaminaPrefix(PlayerDirector __instance, out StaminaScope? __state)
    {
        __state = null;
        if (Self.Character == null || __instance.Character == null || __instance.Character.Pointer != Self.Character.Pointer ||
            Self.DodgePhase is not (DodgePhase.Startup or DodgePhase.Dash)) return;
        // The burst has already paid its fixed cost. Do not charge sprint again or regenerate while bursting.
        // Temporarily replace the two inputs; retain native exhaustion/interval/UI logic and restore after other mods.
        __state = new StaminaScope { Director = __instance, Run = __instance.runStamina, Recover = __instance.recoverStamina };
        __instance.runStamina = 0; __instance.recoverStamina = 0;
    }
    private static void StaminaPostfix(StaminaScope? __state) => __state?.Restore();
    private static Exception? StaminaFinalizer(StaminaScope? __state, Exception? __exception)
    { __state?.Restore(true); return __exception; }

    private static void VelocityPostfix(Character __instance, ref Vector3 __0)
    {
        if (Self.Character == null || Self.Character.Pointer != __instance.Pointer || Self.DodgePhase == DodgePhase.Ready ||
            __instance.DoingSex || !__instance._movementEnabled) return;
        if (RuntimeHost.PanelOpen) { __0.x = 0; __0.z = 0; return; }
        if (Self.DodgePhase == DodgePhase.Startup) { __0.x = 0; __0.z = 0; }
        else if (Self.DodgePhase == DodgePhase.Dash)
        {
            var direction = Self.DodgeDirection;
            var motor = __instance.Motor;
            if (motor != null && motor.GroundingStatus.IsStableOnGround)
            {
                direction = Vector3.ProjectOnPlane(direction, motor.GroundingStatus.GroundNormal).normalized;
                __0 = direction * Self.DodgeSettings.Speed;
            }
            else { __0.x = direction.x * Self.DodgeSettings.Speed; __0.z = direction.z * Self.DodgeSettings.Speed; }
        }
        else { __0.x *= Self.DodgeSettings.RecoveryScale; __0.z *= Self.DodgeSettings.RecoveryScale; }
    }
    private static void RotationPostfix(Character __instance, ref Quaternion __0)
    {
        if (Self.Character != null && Self.Character.Pointer == __instance.Pointer &&
            Self.DodgePhase is DodgePhase.Startup or DodgePhase.Dash && !__instance.DoingSex && __instance._movementEnabled)
            __0 = Quaternion.LookRotation(Self.DodgeDirection, __instance.Motor != null ? __instance.Motor.CharacterUp : Vector3.up);
    }

    internal void Tick()
    {
        if (Director == null || !Director.isActiveAndEnabled) Director = UnityEngine.Object.FindObjectOfType<PlayerDirector>();
        var currentCharacter = Director != null ? Director.Character : null;
        var currentWorld = Director != null ? Director.worldController : null;
        if (currentWorld == null) currentWorld = UnityEngine.Object.FindObjectOfType<WorldController>();
        long newChar = currentCharacter != null ? currentCharacter.Pointer.ToInt64() : 0;
        long newWorld = currentWorld != null ? currentWorld.Pointer.ToInt64() : 0;
        if (newChar != characterId || newWorld != worldId)
        {
            Reset("scene-or-character-change"); characterId = newChar; worldId = newWorld;
            Character = currentCharacter; World = currentWorld;
        }
        Character = currentCharacter; World = currentWorld;
        if (!Options.Enabled.Value) { Reset("disabled"); return; }
        if (Character == null || Director == null || World == null) return;
        if (World.punishmentFlag) arrestCommitted = true;
        if (arrestCommitted || Director.isFadeInProgress)
        {
            ClearCaptures("result-or-scene-fade"); StopDodge("result-or-scene-fade"); return;
        }
        if (!Options.DodgeEnabled.Value || !Character._movementEnabled || Character.DoingSex) StopDodge("state-disallowed");
        // Scaled game time freezes timers when the game pauses. Panel pauses the prototype while editing.
        float dt = Time.timeScale > 0f && !RuntimeHost.PanelOpen ? Time.deltaTime : 0f;
        AdvanceDodge(dt);
        if (Options.DodgeKey.Value != KeyCode.None && Application.isFocused && Input.GetKeyDown(Options.DodgeKey.Value))
            TryDodge();
        if (!CaptureEnabled) { ClearCaptures("capture-disabled"); return; }
        foreach (var action in Captures.Values.ToArray()) AdvanceCapture(action, dt);
        if (Time.unscaledTime >= nextScan)
        {
            nextScan = Time.unscaledTime + Options.ScanInterval.Value;
            foreach (var police in UnityEngine.Object.FindObjectsOfType<PoliceStateControl>()) Register(police);
            foreach (var police in UnityEngine.Object.FindObjectsOfType<SeduciblePoliceControl>()) Register(police);
            foreach (var owner in UnityEngine.Object.FindObjectsOfType<NPCStateControl>())
                if ((owner.npcTagHolder ?? owner.GetComponent<NPCTagHolder>())?.npcType == NPCType.PoliceChief) Register(owner);
            foreach (long id in Police.Where(p => p.Value.Owner == null).Select(p => p.Key).ToArray())
            { Police.Remove(id); lastRejection.Remove(id); }
        }
        if (dt > 0 && !Director.IsSystemMenuOpen)
            foreach (var police in Police.Values.ToArray()) TryCapture(police);
        if (Options.Verbose.Value && Time.unscaledTime >= nextSample)
        {
            nextSample = Time.unscaledTime + Options.LogInterval.Value;
            Plugin.Log.LogInfo($"[Sample] player={characterId} police={Police.Count} capture={Captures.Count} dodge={DodgePhase} elapsed={DodgeElapsed:F3} hooks={CaptureHooksReady}/{DodgeHooksReady}");
        }
    }
    internal void Register(DefaultCharacterControl owner)
    {
        if (owner == null) return;
        long id = owner.Pointer.ToInt64();
        if (!Police.ContainsKey(id))
        {
            var police = new Police(owner);
            if (police.Ordinary != null || police.Seducible != null || police.Chief != null)
            {
                Police[id] = police;
                Plugin.Log.LogInfo($"[Police] registered id={id} name={owner.name} catchDistance={owner.catchDistance:F3}");
            }
        }
    }

    private string? DodgeBlocked()
    {
        if (!Options.Enabled.Value || !Options.DodgeEnabled.Value || !DodgeHooksReady) return "disabled-or-hook-unavailable";
        if (Character == null || Director == null || World == null) return "player-not-ready";
        if (arrestCommitted || World.punishmentFlag) return "arrested";
        if (Time.timeScale <= 0 || !Application.isFocused) return "paused-or-unfocused";
        if (RuntimeHost.PanelOpen || Director.IsSystemMenuOpen || Director.isFadeInProgress || Director.isFinishing ||
            !Director.enableControlChar || KeyBindings.PlayerLocked || KeyBindings.capturing || KeyBindings.captureEndFrame == Time.frameCount) return "input-owned-or-control-locked";
        var selected = EventSystem.current != null ? EventSystem.current.currentSelectedGameObject : null;
        if (selected != null && (selected.GetComponent<InputField>()?.isFocused == true || selected.GetComponent("TMP_InputField") != null)) return "text-input";
        if (Character.DoingSex || !Character._movementEnabled) return "movement-disabled";
        if (DodgePhase != DodgePhase.Ready) return "action-in-progress";
        if (Character.mainCharStateControl == null) return "stamina-not-ready";
        return null;
    }
    internal bool TryDodge(bool isolated = false)
    {
        string? reason = isolated ? null : DodgeBlocked();
        if (reason != null) { Plugin.Log.LogInfo("[Dodge] rejected reason=" + reason); LastStatus = "闪避拒绝：" + reason; return false; }
        if (Character == null || Character.mainCharStateControl == null || DodgePhase != DodgePhase.Ready) return false;
        DodgeAnimation.Prepare(Character);
        var settings = Options.Dodge(DodgeAnimation.ScaledRunSpeed);
        float stamina = Character.mainCharStateControl.CurrentStamina;
        if (!float.IsFinite(stamina) || stamina < settings.Cost)
        { Plugin.Log.LogInfo($"[Dodge] rejected reason=insufficient-stamina stamina={stamina:F2} cost={settings.Cost:F2}"); LastStatus = "体力不足"; return false; }
        Vector3 direction = Character._moveInputVector;
        direction.y = 0;
        if (direction.sqrMagnitude < .0001f) { direction = Character.transform.forward; direction.y = 0; }
        if (direction.sqrMagnitude < .0001f) return false;
        DodgeSettings = settings; DodgeDirection = direction.normalized; DodgeElapsed = 0; ProtectionUsed = false;
        DodgeNumber = ++nextAction; DodgePhase = Rules.Phase(0, settings); dodgeOrigin = Character.transform.position;
        Character.mainCharStateControl.CurrentStamina = stamina - settings.Cost;
        DodgeVisual.Glow(Character, Options.White, Options.WhiteIntensity.Value);
        Plugin.Log.LogInfo($"[Dodge #{DodgeNumber}] start stamina={stamina:F2}->{stamina-settings.Cost:F2} dir={DodgeDirection} speed={settings.Speed:F2} native-run={DodgeAnimation.BaseRunSpeed:F3} global-run-scale={DodgeAnimation.GlobalMultiplier:F3} dodge-scale={Options.Speed.Value:F3} startup={settings.Startup:F3} dash={settings.Dash:F3} recovery={settings.Recovery:F3} recovery-scale={settings.RecoveryScale:F3} window=[{settings.WindowStart:F3},{settings.WindowEnd:F3})");
        LastStatus = "闪避 #" + DodgeNumber; return true;
    }
    internal void AdvanceDodge(float dt)
    {
        if (DodgePhase == DodgePhase.Ready) return;
        DodgeElapsed += dt;
        var phase = Rules.Phase(DodgeElapsed, DodgeSettings);
        if (phase != DodgePhase)
        {
            Plugin.Log.LogInfo($"[Dodge #{DodgeNumber}] phase={phase} elapsed={DodgeElapsed:F3}"); DodgePhase = phase;
            if (phase == DodgePhase.Dash) DodgeAnimation.Play(DodgeNumber);
            else
            {
                bool wasAnimating = DodgeAnimation.Active;
                DodgeAnimation.Stop();
                if (wasAnimating && Character != null) Character._pendingRootMotionLocalDelta = Vector3.zero;
            }
            if (phase == DodgePhase.Recovery) DodgeVisual.ClearGlow();
            if (phase == DodgePhase.Ready) StopDodge("complete");
        }
    }
    internal bool Protect(CaptureAction action)
    {
        if (DodgePhase != DodgePhase.Dash || ProtectionUsed || !Rules.Window(DodgeElapsed, DodgeSettings)) return false;
        ProtectionUsed = true;
        Plugin.Log.LogInfo($"[Capture #{action.Number}] perfect-dodge #{DodgeNumber} elapsed={DodgeElapsed:F3}; one instance consumed");
        return true;
    }
    internal void StopDodge(string reason)
    {
        bool wasAnimating = DodgeAnimation.Active;
        DodgeAnimation.Stop();
        if (wasAnimating && Character != null) Character._pendingRootMotionLocalDelta = Vector3.zero;
        if (DodgePhase != DodgePhase.Ready || DodgeVisual.HasGlow)
        {
            float distance = Character != null ? Vector3.Distance(dodgeOrigin, Character.transform.position) : 0;
            Plugin.Log.LogInfo($"[Dodge #{DodgeNumber}] end reason={reason} elapsed={DodgeElapsed:F3} actual-distance={distance:F3}");
        }
        DodgePhase = DodgePhase.Ready; DodgeVisual.Clear();
    }

    private bool PoliceAvailable(Police police)
    {
        var owner = police.Owner;
        var movement = police.Movement ?? owner.GetComponent<NPCMovementController>();
        return owner != null && owner.isActiveAndEnabled && !police.Incapacitated && !owner.isCoroutineRunning &&
            (movement == null || (!movement.IsMovementPaused && !movement.IsInSexState && !movement.IsExhaustionFrozen && !movement.IsVisionFrozen));
    }
    internal bool TryCapture(Police police)
    {
        if (Captures.ContainsKey(police.Id)) return false;
        var owner = police.Owner;
        string? reason = null;
        if (Character == null || World == null || arrestCommitted || !CaptureEnabled) return false;
        if (owner == null || !PoliceAvailable(police)) reason = "police-unavailable";
        else if (!police.Chasing) reason = "not-chasing";
        else if (owner.traceTarget == null || !IsPlayer(owner.traceTarget)) reason = "target-is-not-player";
        else if (!police.HasArrest) reason = "native-arrest-listener-missing";
        var settings = Options.Capture();
        if (reason == null && !InSector(owner!.transform.position, owner.transform.forward, settings.TriggerRadius, settings.TriggerAngle, settings.Height, out _, out _, out _)) reason = "outside-start-sector";
        if (reason == null && Occluded(owner!, settings)) reason = "occluded";
        if (reason != null)
        {
            if (Options.Verbose.Value && (!lastRejection.TryGetValue(police.Id, out float last) || Time.unscaledTime - last >= Options.LogInterval.Value))
            { lastRejection[police.Id] = Time.unscaledTime; Plugin.Log.LogInfo($"[Capture] rejected police={police.Id} reason={reason}"); }
            return false;
        }
        StartCapture(police, Character, settings); return true;
    }
    private bool IsPlayer(GameObject target) => Character != null &&
        (target.GetComponentInParent<Character>()?.Pointer == Character.Pointer ||
         target.GetComponentInChildren<Character>()?.Pointer == Character.Pointer);

    internal CaptureAction StartCapture(Police police, Character target, CaptureSettings settings)
    {
        var owner = police.Owner;
        var action = new CaptureAction { Police = police, Target = target, Settings = settings, Number = ++nextAction,
            Direction = Vector3.ProjectOnPlane(owner.transform.forward, Vector3.up).normalized,
            Rotation = owner.transform.rotation, Animator = owner.anim ?? owner.GetComponent<Animator>(), Agent = owner.agent ?? owner.GetComponent<NavMeshAgent>() };
        if (action.Animator != null)
        {
            action.WasRootMotion = action.Animator.applyRootMotion;
            action.WasAnimatorEnabled = action.Animator.enabled;
            action.WasKeepAnimatorState = action.Animator.keepAnimatorControllerStateOnDisable;
            var state = action.Animator.GetCurrentAnimatorStateInfo(0); action.OriginalState = state.fullPathHash; action.OriginalTime = state.normalizedTime;
            foreach (int layer in new[] { owner.walkLayerIndex, owner.runLayerIndex }.Distinct())
                if (layer > 0 && layer < action.Animator.layerCount)
                    action.LayerWeights[layer] = action.Animator.GetLayerWeight(layer);
            // The shipped controller's base pose sinks without its locomotion layers/root motion.
            // Keep the complete pose and controller state, including System's animation speed.
            action.Animator.keepAnimatorControllerStateOnDisable = true;
            action.Animator.enabled = false;
        }
        if (action.Agent != null && action.Agent.isActiveAndEnabled && action.Agent.isOnNavMesh)
        {
            action.WasStopped = action.Agent.isStopped; action.WasAgentRotation = action.Agent.updateRotation;
            action.Agent.isStopped = true; action.Agent.updateRotation = false; action.Agent.velocity = Vector3.zero;
        }
        Captures.Add(police.Id, action);
        action.Visual.Glow(owner, Options.Red, Options.RedIntensity.Value);
        Animations.Attempt(action, false);
        Plugin.Log.LogInfo($"[Capture #{action.Number}] start police={police.Id} name={owner.name} windup={settings.Windup:F3} commit={settings.CommitAt:F3} radius={settings.Radius:F3} full-angle={settings.Angle:F1}");
        return action;
    }
    internal void AdvanceCapture(CaptureAction action, float dt)
    {
        if (!Captures.ContainsKey(action.Police.Id)) return;
        var owner = action.Police.Owner;
        if (owner == null || action.Target == null || !owner.isActiveAndEnabled || action.Police.Incapacitated ||
            owner.isCoroutineRunning || action.Police.Movement?.IsInSexState == true ||
            action.Police.Movement?.IsMovementPaused == true || action.Police.Movement?.IsExhaustionFrozen == true ||
            action.Police.Movement?.IsVisionFrozen == true || arrestCommitted)
        { EndCapture(action, "cancelled-external-state"); return; }
        if (action.Phase == CapturePhase.Recovery)
        {
            action.RecoveryElapsed += dt;
            if (action.RecoveryElapsed >= action.Settings.Recovery) EndCapture(action, "miss-recovery-complete");
            return;
        }
        float before = action.Elapsed;
        action.Elapsed += dt;
        float turningTime = Math.Max(0, Math.Min(action.Elapsed, action.Settings.CommitAt) - Math.Min(before, action.Settings.CommitAt));
        if (turningTime > 0)
        {
            var delta = action.Target.transform.position - owner.transform.position; delta.y = 0;
            if (delta.sqrMagnitude > .0001f)
                action.Rotation = Quaternion.RotateTowards(action.Rotation, Quaternion.LookRotation(delta.normalized), action.Settings.TurnSpeed * turningTime);
            owner.transform.rotation = action.Rotation;
            action.Direction = owner.transform.forward;
        }
        if (action.Elapsed >= action.Settings.CommitAt && action.Phase == CapturePhase.Windup)
        { action.Phase = CapturePhase.Committed; Plugin.Log.LogInfo($"[Capture #{action.Number}] committed elapsed={action.Elapsed:F3} dir={action.Direction}"); }
        if (action.Elapsed < action.Settings.Windup) return;
        bool inside = InSector(owner.transform.position, action.Direction, action.Settings.Radius, action.Settings.Angle,
            action.Settings.Height, out float distance, out float angle, out float height);
        bool occluded = inside && Occluded(owner, action.Settings);
        bool perfect = inside && !occluded && Protect(action);
        Plugin.Log.LogInfo($"[Capture #{action.Number}] resolve distance={distance:F3} angle={angle:F2} height={height:F3} inside={inside} occluded={occluded} perfect={perfect} elapsed={action.Elapsed:F3}");
        action.Visual.ClearGlow();
        if (inside && !occluded && !perfect)
        {
            if (action.Police.HasArrest && !arrestCommitted)
            {
                arrestCommitted = true; LastStatus = "抓捕命中 #" + action.Number;
                ClearCaptures("arrest-committed"); StopDodge("arrest-committed");
                Plugin.Log.LogInfo($"[Arrest #{action.Number}] invoking native result once; source={(action.Police.Chief != null ? "chief.World.Player_OnPunishment" : "police.OnPunishment")}"); action.Police.Arrest(); return;
            }
            Plugin.Log.LogWarning($"[Capture #{action.Number}] native callback disappeared; treating as miss");
        }
        action.Phase = CapturePhase.Recovery; action.RecoveryElapsed = 0;
        Animations.Attempt(action, true);
        LastStatus = "抓捕落空 #" + action.Number;
        Plugin.Log.LogInfo($"[Capture #{action.Number}] miss recovery={action.Settings.Recovery:F3}");
    }
    internal bool InSector(Vector3 origin, Vector3 direction, float radius, float fullAngle, float maxHeight,
        out float distance, out float angle, out float height)
    {
        Vector3 delta = Character != null ? Character.transform.position - origin : Vector3.zero;
        height = delta.y; delta.y = 0; direction.y = 0;
        distance = delta.magnitude; angle = distance < .0001f ? 0 : Vector3.Angle(direction, delta);
        return Character != null && Rules.Sector(distance, angle, height, radius, fullAngle, maxHeight);
    }
    internal bool Occluded(DefaultCharacterControl owner, CaptureSettings settings)
    {
        if (Character == null) return true;
        Vector3 origin = owner.transform.position + Vector3.up * settings.ProbeHeight;
        Vector3 destination = Character.transform.position + Vector3.up * settings.ProbeHeight;
        Vector3 delta = destination - origin;
        int mask = settings.ObstacleMask == -1 ? (int)owner.obstacleMask : settings.ObstacleMask;
        if (mask == 0 || delta.sqrMagnitude < .00001f) return false;
        foreach (var hit in Physics.RaycastAll(origin, delta.normalized, delta.magnitude, mask, QueryTriggerInteraction.Ignore))
        {
            if (hit.collider == null) continue;
            var tr = hit.collider.transform;
            if (tr.IsChildOf(owner.transform) || tr.IsChildOf(Character.transform)) continue;
            return true;
        }
        return false;
    }
    internal void LateTick()
    {
        DodgeAnimation.Pause(RuntimeHost.PanelOpen || Time.timeScale <= 0);
        foreach (var action in Captures.Values.ToArray())
        {
            if (action.Police.Owner == null) continue;
            action.Police.Owner.transform.rotation = action.Rotation;
            if (action.Animator != null)
            {
                if (action.AnimationPlayed) action.Animator.applyRootMotion = false;
                else action.Animator.enabled = false;
            }
            if (action.Agent != null && action.Agent.isActiveAndEnabled && action.Agent.isOnNavMesh)
            { action.Agent.isStopped = true; action.Agent.updateRotation = false; action.Agent.velocity = Vector3.zero; }
            if (Options.Debug.Value) action.Visual.Sector(action.Police.Owner.transform.position, action.Direction, action.Settings);
            else action.Visual.ClearLines();
        }
        if (Character == null) return;
        if (DodgePhase is DodgePhase.Startup or DodgePhase.Dash)
        {
            bool window = DodgePhase == DodgePhase.Dash && !ProtectionUsed && Rules.Window(DodgeElapsed, DodgeSettings);
            float brightness = window ? Options.WindowIntensity.Value : Options.WhiteIntensity.Value *
                (.35f + .65f * Math.Abs(MathF.Sin(DodgeElapsed * Options.BlinkHz.Value * MathF.PI)));
            DodgeVisual.SetGlow(Options.White, brightness);
        }
        if (Options.Debug.Value && DodgePhase != DodgePhase.Ready)
            DodgeVisual.Direction(Character.transform.position, DodgeDirection, DodgeSettings.Speed * DodgeSettings.Dash);
        else DodgeVisual.ClearLines();
    }
    internal void EndCapture(CaptureAction action, string reason)
    {
        Captures.Remove(action.Police.Id); action.Visual.Clear();
        if (action.Animator != null)
        {
            if (action.AnimationPlayed)
            {
                action.Animator.applyRootMotion = action.WasRootMotion;
                foreach (var pair in action.LayerWeights)
                    if (pair.Key < action.Animator.layerCount) action.Animator.SetLayerWeight(pair.Key, pair.Value);
                if (action.OriginalState != 0) action.Animator.Play(action.OriginalState, 0, action.OriginalTime);
            }
            action.Animator.enabled = action.WasAnimatorEnabled;
            action.Animator.keepAnimatorControllerStateOnDisable = action.WasKeepAnimatorState;
        }
        if (action.Agent != null && action.Agent.isActiveAndEnabled && action.Agent.isOnNavMesh)
        {
            // External pauses have priority over this action's stop ownership.
            bool externalPause = action.Police.Incapacitated || action.Police.Movement?.IsMovementPaused == true ||
                action.Police.Movement?.IsInSexState == true || action.Police.Movement?.IsExhaustionFrozen == true || action.Police.Movement?.IsVisionFrozen == true;
            if (!externalPause) action.Agent.isStopped = action.WasStopped;
            action.Agent.updateRotation = action.WasAgentRotation;
        }
        Plugin.Log.LogInfo($"[Capture #{action.Number}] end reason={reason}");
    }
    internal void ClearCaptures(string reason) { foreach (var action in Captures.Values.ToArray()) EndCapture(action, reason); }
    internal void Reset(string reason)
    {
        ClearCaptures(reason); StopDodge(reason); Police.Clear(); lastRejection.Clear(); nextScan = 0;
        arrestCommitted = false;
    }
}
