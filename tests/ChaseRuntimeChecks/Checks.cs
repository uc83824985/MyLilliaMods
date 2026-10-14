using BepInEx;
using BepInEx.Configuration;
using BepInEx.Logging;
using BepInEx.Unity.IL2CPP;
using HarmonyLib;
using Il2CppInterop.Runtime;
using Il2CppInterop.Runtime.Injection;
using KinematicCharacterController;
using LilliaChasePrototype;
using ProjectTarkovH;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;
using Character = ProjectTarkovH.CharacterController;
using Prototype = LilliaChasePrototype.Plugin;

[BepInPlugin("local.lillia.chase.runtimechecks", "Chase Runtime Checks", "0.1.0")]
[BepInDependency(Prototype.Guid)]
public sealed class Checks : BasePlugin
{
    private static ManualLogSource log = null!;
    private static bool started, done;
    private static bool waitingGui;
    private static float guiStart;
    internal static bool GuiPassed;
    internal static bool MotionPassed;
    internal static string GuiPath => Path.Combine(Paths.GameRootPath, "MyLilliaMods/artifacts/parameter-panel.png");
    internal static void GuiCheck(bool ok, string label) => Check(ok, label);
    internal static void GuiFailure(Exception ex) { waitingGui = false; log.LogError("CHASE CHECK FAILED: " + ex); Application.Quit(); }
    private static float startedAt;
    private static int assertions, arrested;
    private static double observedCatchDistance;
    private static bool injectAlertFailure;
    private static AsyncOperationHandle<GameObject>[] handles = Array.Empty<AsyncOperationHandle<GameObject>>();
    private static AsyncOperationHandle<GameObject> playerPrefab = null!;
    internal static GameObject[] Prefabs => handles.Select(h => h.Result).ToArray();
    private static readonly Harmony TestHarmony = new("local.lillia.chase.runtimechecks");
    public override void Load()
    {
        log = Log;
        AudioListener.volume = 0; AudioListener.pause = true;
        TestHarmony.Patch(AccessTools.Method(typeof(DataHolder), "Update"), postfix: new HarmonyMethod(typeof(Checks), nameof(Tick)));
        // Observe entry into the original result method without saving, rewards or scene transitions.
        TestHarmony.Patch(AccessTools.Method(typeof(WorldController), "Player_OnPunishment"), prefix: new HarmonyMethod(typeof(Checks), nameof(ObserveArrest)));
        foreach (Type type in new[] { typeof(PoliceStateControl), typeof(SeduciblePoliceControl) })
            TestHarmony.Patch(AccessTools.Method(type, "CheckAlertCost"), prefix: new HarmonyMethod(typeof(Checks), nameof(ObserveAlert)) { priority = Priority.Last });
    }
    private static bool ObserveArrest() { arrested++; return false; }
    private static void ObserveAlert(DefaultCharacterControl __instance)
    { observedCatchDistance = __instance.catchDistance; if (injectAlertFailure) throw new InvalidOperationException("expected alert fixture failure"); }
    private static void Check(bool ok, string label)
    { if (!ok) throw new Exception(label); assertions++; log.LogInfo("PASS " + label); }
    private static void Tick()
    {
        if (done)
        {
            if (waitingGui && GuiPassed && MotionPassed && File.Exists(GuiPath))
            { waitingGui = false; log.LogInfo("PASS independent Canvas parameter panel rendered"); assertions++; log.LogInfo($"ALL {assertions} CHASE RUNTIME CHECKS PASSED"); Application.Quit(); }
            else if (waitingGui && Time.unscaledTime - guiStart > 10)
            { waitingGui = false; log.LogError("CHASE CHECK FAILED: Canvas panel timeout"); Application.Quit(); }
            return;
        }
        try
        {
            if (!started)
            {
                started = true; startedAt = Time.unscaledTime;
                handles = new[] { "police", "police_chief", "police_seducible" }.Select(name =>
                    Addressables.LoadAssetAsync<GameObject>((Il2CppSystem.String)("Assets/00. PakoneSoft/Prefabs/NPC/" + name + ".prefab"))).ToArray();
                playerPrefab = Addressables.LoadAssetAsync<GameObject>((Il2CppSystem.String)"Assets/00. PakoneSoft/Prefabs/MainChar/Ingame_heroine_prefab.prefab");
                return;
            }
            if (Time.unscaledTime - startedAt > 45) throw new Exception("prefab load timeout");
            if (handles.Any(handle => !handle.IsDone) || !playerPrefab.IsDone) return;
            done = true;
            var player = playerPrefab.Result.GetComponentInChildren<Character>(true);
            AuditNativeParticles();
            log.LogInfo($"PLAYER AUDIT character={player != null} walk={player?.MaxWalkSpeed} run={player?.MaxRunSpeed} animator={player?.anim?.name}");
            foreach (var animator in playerPrefab.Result.GetComponentsInChildren<Animator>(true))
            {
                log.LogInfo($"PLAYER ANIMATOR {animator.name} controller={animator.runtimeAnimatorController?.name}");
                foreach (var clip in animator.runtimeAnimatorController!.animationClips)
                    if (clip.name.Contains("Run", StringComparison.OrdinalIgnoreCase)) log.LogInfo($"PLAYER RUN CLIP {clip.name} avg={clip.averageSpeed} loop={clip.isLooping} events={clip.events.Length}");
            }
            foreach (var handle in handles) Check(handle.Result != null, "real police prefab loaded");
            Run();
            if (File.Exists(GuiPath)) File.Delete(GuiPath);
            ClassInjector.RegisterTypeInIl2Cpp<GuiProbe>();
            new GameObject("ChaseGUIProbe").AddComponent<GuiProbe>();
            ClassInjector.RegisterTypeInIl2Cpp<PursuitFrameProbe>();
            new GameObject("PursuitFrameProbe").AddComponent<PursuitFrameProbe>();
            RuntimeHost.PanelOpen = true;
            waitingGui = true; guiStart = Time.unscaledTime;
        }
        catch (Exception ex) { done = true; log.LogError("CHASE CHECK FAILED: " + ex); }
        finally { if (done && !waitingGui) Application.Quit(); }
    }
    private static void AuditNativeParticles()
    {
        foreach (string key in new[] { "Particles/Showcase/Prefabs/fx_sparks", "Particles/Showcase/Prefabs/fx_fire", "Particles/Showcase/Prefabs/fx_smoke", "Particles/Fog/Prefabs/Ground Procedural Fog" })
        {
            var prefab = Resources.Load<GameObject>(key);
            if (prefab == null) { log.LogInfo($"PARTICLE AUDIT resource={key} unavailable"); continue; }
            var particles = prefab.GetComponentsInChildren<Transform>(true).Where(t => t.GetComponent("ParticleSystem") != null).ToArray();
            log.LogInfo($"PARTICLE AUDIT resource={key} systems={particles.Length} names=[{string.Join(",", particles.Select(t => t.name))}] scripts=[{string.Join(",", prefab.GetComponentsInChildren<MonoBehaviour>(true).Select(s => s.GetIl2CppType().FullName))}]");

        }
        var attached = playerPrefab.Result.GetComponentsInChildren<Transform>(true).Where(t => t.GetComponent("ParticleSystem") != null).ToArray();
        log.LogInfo($"PARTICLE AUDIT heroine-attached={attached.Length} names=[{string.Join(",", attached.Select(t => t.name))}]");
    }
    private static void Run()
    {
        var originalEngine = Prototype.Engine; var originalSettings = Prototype.Options;
        var roots = new List<GameObject>();
        var actors = new List<Police>();
        var engine = new Engine { CaptureHooksReady = true, DodgeHooksReady = true };
        var file = new ConfigFile(Path.Combine(Paths.GameRootPath, "MyLilliaMods/artifacts/runtime-test.cfg"), false);
        var settings = new Settings(file);
        settings.Apply(true);
        Prototype.Engine = engine; Prototype.Options = settings;
        settings.File.SaveOnConfigSet = false; settings.HeavyChance.Value = 0;
        CaptureSettings LegacyCapture() => settings.Capture() with { MoveScale = 0, CommitAt = .15f, TurnSpeed = 180, Recovery = .85f, Radius = 2, Angle = 90 };
        try
        {
            var fixture = new GameObject("ChasePlayerFixture"); fixture.SetActive(false); roots.Add(fixture);
            var character = fixture.AddComponent<Character>(); character.enabled = false;
            var motor = fixture.AddComponent<KinematicCharacterMotor>(); motor.enabled = false;
            var state = fixture.AddComponent<MainCharStateControl>(); state.enabled = false;
            character.Motor = motor;
            character._movementEnabled = true; character._suppressRootMotionUntilFreshMotion = false; character._locomotionMode = 1;
            motor._characterUp = Vector3.up; motor._transientRotation = Quaternion.identity;
            motor.GroundingStatus = new CharacterGroundingReport { IsStableOnGround = true, FoundAnyGround = true,
                GroundNormal = Vector3.up, InnerGroundNormal = Vector3.up, OuterGroundNormal = Vector3.up };
            state.MaxStamina = 100; state.CurrentStamina = 80;
            engine.Character = character;
            var worldRoot = new GameObject("ChaseResultFixture"); worldRoot.SetActive(false); roots.Add(worldRoot);
            var world = worldRoot.AddComponent<WorldController>(); world.enabled = false; engine.World = world;

            Vector3 NativeVelocity(float rootDistance)
            {
                character._pendingRootMotionLocalDelta = new Vector3(0, 0, rootDistance);
                Vector3 velocity = Vector3.zero; character.UpdateVelocity(ref velocity, .1f); return velocity;
            }
            state.CurrentStamina = 14;
            Check(!engine.TryDodge(true) && state.CurrentStamina == 14, "insufficient stamina rejects without charge");
            state.CurrentStamina = 80;
            character._moveInputVector = Vector3.right;
            Check(engine.TryDodge(true) && state.CurrentStamina == 55, "dodge charges exactly once");
            Check(!engine.TryDodge(true) && state.CurrentStamina == 55, "repeated input cannot charge or restart");
            Check(engine.DodgePhase == DodgePhase.Dash && engine.DodgeAnimation.Active == false, "zero startup enters dash immediately even without animator");
            engine.AdvanceDodge(.05f);
            var velocity = NativeVelocity(1);
            Check(Math.Abs(velocity.x - engine.DodgeSettings.Speed) < .001f && Math.Abs(velocity.z) < .001f, "native dash velocity overrides root sample in locked direction");
            character._moveInputVector = Vector3.back;
            Check(engine.DodgeDirection == Vector3.right && NativeVelocity(1).x == engine.DodgeSettings.Speed, "new input cannot change dash direction");
            engine.AdvanceDodge(.31f);
            float baseline;
            var recoveryVelocity = NativeVelocity(1);
            engine.StopDodge("test"); baseline = NativeVelocity(1).magnitude;
            Check(Math.Abs(recoveryVelocity.magnitude - baseline * .1f) < .001f, "recovery scales final native/modded velocity");
            character._moveInputVector = Vector3.zero; character.transform.rotation = Quaternion.identity;
            state.CurrentStamina = 80;
            Check(engine.TryDodge(true) && engine.DodgeDirection == Vector3.forward, "no input uses current facing");
            engine.StopDodge("test");
            var director = fixture.AddComponent<PlayerDirector>(); director.enabled = false;
            director._Character_k__BackingField = character; director._mainCharStateControl_k__BackingField = state;
            var sliderRoot = new GameObject("ChaseStaminaSlider", Il2CppType.Of<RectTransform>()); sliderRoot.SetActive(false); roots.Add(sliderRoot);
            director.staminaSlider = sliderRoot.AddComponent<UnityEngine.UI.Slider>();
            director.runStamina = 4; director.recoverStamina = 3; director.runInterval = 0; director.recoverInterval = 0;
            engine.DodgePhase = DodgePhase.Dash; character.IsRunning = true; state.CurrentStamina = 80;
            director.runIntervalCount = 1; director.CheckStaminaStatus();
            log.LogInfo($"STAMINA native burst result={state.CurrentStamina} run-base={director.runStamina} recover-base={director.recoverStamina}");
            Check(state.CurrentStamina == 80 && director.runStamina == 4, "dash fixed cost avoids duplicate sprint drain and restores base cost");
            character.IsRunning = false; director.recoverIntervalCount = 1; director.CheckStaminaStatus();
            Check(state.CurrentStamina == 80 && director.recoverStamina == 3, "burst does not regenerate walking stamina");
            engine.StopDodge("stamina-test"); character.IsRunning = true; director.runIntervalCount = 1; director.CheckStaminaStatus();
            float expectedStamina = Math.Max(0, 80 - 4 * RunSpeedCompatibility.GlobalMultiplier("RunStaminaCostMultiplier"));
            Check(Math.Abs(state.CurrentStamina - expectedStamina) < .001f && director.runStamina == 4,
                "normal sprint stamina resumes with native/modded cost including zero");
            character.IsRunning = false; state.CurrentStamina = 80;
            CheckActualMotor(engine, fixture, character, motor, roots);
            CheckRunPlayback(engine, settings, roots);
            state.CurrentStamina = 80;
            Check(engine.TryDodge(true) && state.CurrentStamina == 55, "perfect reward fixture pays 25 stamina");
            engine.AdvanceDodge(.05f);
            Check(engine.Protect(new CaptureAction()) && state.CurrentStamina == 80 && engine.DodgeSettings.Recovery == 0,
                "perfect contact refunds full cost and cancels recovery");
            engine.AdvanceDodge(.25f);
            Check(engine.DodgePhase == DodgePhase.Ready && !engine.DodgeAnimation.Active, "perfect finishes at end of remaining burst");

            foreach (var handle in handles)
            {
                var parent = new GameObject("ChasePoliceFixture"); parent.SetActive(false); roots.Add(parent);
                var root = UnityEngine.Object.Instantiate(handle.Result, parent.transform, false);
                foreach (var script in root.GetComponentsInChildren<MonoBehaviour>(true)) script.enabled = false;
                foreach (var agent in root.GetComponentsInChildren<NavMeshAgent>(true)) agent.enabled = false;
                foreach (var collider in root.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
                var owner = root.GetComponent<DefaultCharacterControl>();
                owner.npcTagHolder = root.GetComponent<NPCTagHolder>();
                log.LogInfo($"COMPONENTS {handle.Result.name}: " + string.Join(", ", root.GetComponents<MonoBehaviour>().Select(s => s.GetIl2CppType().FullName)));
                var animator = root.GetComponent<Animator>(); owner.anim = animator;
                var patrol = root.GetComponent<PatrolMovement>(); owner.patrolMovement = patrol; patrol._characterControl = owner;
                patrol.agent = root.GetComponent<NavMeshAgent>();
                root.transform.position = Vector3.zero; root.transform.rotation = Quaternion.identity;
                parent.SetActive(true); owner.enabled = true;
                animator.cullingMode = AnimatorCullingMode.AlwaysAnimate; animator.Rebind(); animator.Update(0);
                log.LogInfo($"ANIMATION INVENTORY {handle.Result.name}: " + string.Join(", ", animator.runtimeAnimatorController.animationClips.Select(c => c.name)));
                var police = new Police(owner); engine.Register(owner);
                log.LogInfo($"GEOMETRY {handle.Result.name} agent-radius={patrol.agent.radius:F4} scale={root.transform.lossyScale}");
                foreach (var body in root.GetComponentsInChildren<Collider>(true).Where(c => !c.isTrigger))
                    log.LogInfo($"GEOMETRY collider {handle.Result.name}/{body.name} enabled={body.enabled} size={body.bounds.size} capsule-radius={body.TryCast<CapsuleCollider>()?.radius}");
                actors.Add(police);
                log.LogInfo($"CONTROLLER {handle.Result.name}: ordinary={police.Ordinary != null} seducible={police.Seducible != null} chief={police.Chief != null} tag={owner.npcTagHolder?.npcType}");
                if (police.Movement != null)
                {
                    police.Movement.isMovementPaused = false; police.Movement.isInSexState = false;
                    police.Movement.isExhaustionFrozen = false; police.Movement.isVisionFrozen = false;
                }
                if (police.Ordinary != null) { police.Ordinary._cachedWorldController = world; police.Ordinary.OnPunishment = (Il2CppSystem.Action)(Action)(() => world.Player_OnPunishment()); }
                else if (police.Seducible != null) { police.Seducible._cachedWorldController = world; police.Seducible.OnPunishment = (Il2CppSystem.Action)(Action)(() => world.Player_OnPunishment()); }
                owner.traceTarget = fixture; owner.targetChar = state;
                owner.TargetEnabled = true;
                if (police.Ordinary != null) police.Ordinary._alertValue = 100;
                if (police.Seducible != null) police.Seducible._alertValue = 100;
                owner.catchDistance = 1.5; owner.obstacleMask = 0;
                character.transform.position = Vector3.forward;
                patrol.PatrolStatus = PatrolStatus.Chase;
                bool failedNative = false;
                int beforeArrest = arrested;
                try { if (police.Ordinary != null) police.Ordinary.CheckAlertCost(); else if (police.Seducible != null) police.Seducible.CheckAlertCost(); }
                catch (Exception ex) { failedNative = true; log.LogWarning("native alert fixture exception: " + ex.Message); }
                Check(owner.catchDistance == 1.5, "native alert restores catchDistance " + handle.Result.name);
                Check(arrested == beforeArrest, "old native near-distance arrest suppressed " + handle.Result.name);
                Check(!failedNative, "native alert entry completes " + handle.Result.name);
                if (police.Chief == null)
                {
                    Check(observedCatchDistance == 0, "real native alert sees suppressed distance " + handle.Result.name);
                    settings.CaptureEnabled.Value = false;
                    if (police.Ordinary != null) police.Ordinary.CheckAlertCost(); else police.Seducible!.CheckAlertCost();
                    Check(arrested == beforeArrest + 1, "disabling prototype restores original near-distance Arrest " + handle.Result.name);
                    settings.CaptureEnabled.Value = true; engine.Reset("restore-original-probe");
                    injectAlertFailure = true;
                    try { if (police.Ordinary != null) police.Ordinary.CheckAlertCost(); else police.Seducible!.CheckAlertCost(); }
                    catch (Exception ex) { log.LogInfo("EXPECTED FIXTURE EXCEPTION " + ex.Message); }
                    finally { injectAlertFailure = false; }
                    Check(owner.catchDistance == 1.5, "native exception restores original distance " + handle.Result.name);
                }
                patrol.PatrolStatus = PatrolStatus.Chase;

                animator.SetLayerWeight(owner.runLayerIndex, 1); animator.SetFloat("Speed", 1);
                for (int i = 0; i < 80; i++) animator.Update(.02f);
                var cachedProbe = new DodgeAnimation(); cachedProbe.Prepare(animator, patrol.RunSpeed);
                int sampleCount = DodgeAnimation.SamplingCount;
                var rawScales = new HashSet<Vector3>();
                for (int heading = 0; heading < 360; heading += 17)
                { root.transform.rotation = Quaternion.Euler(0, heading, 0); rawScales.Add(root.transform.lossyScale); cachedProbe.Prepare(animator, patrol.RunSpeed); }
                log.LogInfo($"CACHE AUDIT {handle.Result.name} distinct-raw-scales={rawScales.Count} new-samples={DodgeAnimation.SamplingCount-sampleCount}");
                root.transform.rotation = Quaternion.identity;
                Check(DodgeAnimation.SamplingCount == sampleCount, "rotations reuse quantized root-speed cache " + handle.Result.name);
                float savedAnimationSpeed = animator.speed, savedAgentSpeed = patrol.agent.speed;
                engine.ChaseSpeed.Apply(engine, patrol);
                var playerSpeedProbe = new DodgeAnimation(); playerSpeedProbe.Prepare(character);
                var npcSpeedProbe = new DodgeAnimation(); npcSpeedProbe.Prepare(animator, patrol.RunSpeed);
                float globalRun = RunSpeedCompatibility.GlobalMultiplier();
                float expectedPursuit = playerSpeedProbe.ScaledRunSpeed * settings.ChaseSpeedRatio.Value;
                float effectivePursuit = npcSpeedProbe.BaseRunSpeed * animator.speed * globalRun / RunSpeedCompatibility.AnimationRate(globalRun);
                Check(Math.Abs(effectivePursuit - expectedPursuit) < .001f && Math.Abs(patrol.agent.speed - expectedPursuit) < .001f,
                    "normal pursuit stride and navigation cap match player ratio " + handle.Result.name);
                float measuredStride = 0;
                for (int i = 0; i < 100; i++)
                {
                    animator.Update(.02f);
                    measuredStride += Vector3.ProjectOnPlane(animator.deltaPosition, Vector3.up).magnitude;
                }
                measuredStride = measuredStride / 2 * globalRun / RunSpeedCompatibility.AnimationRate(globalRun);
                log.LogInfo($"PURSUIT MEASURED {handle.Result.name} stride-speed={measuredStride:F3} expected={expectedPursuit:F3}");
                Check(Math.Abs(measuredStride - expectedPursuit) < expectedPursuit * .1f, "native pursuit animation produces target root stride " + handle.Result.name);
                settings.ChaseSpeedRatio.Value = 1.3f; engine.ChaseSpeed.Apply(engine, patrol);
                Check(Math.Abs(patrol.agent.speed - playerSpeedProbe.ScaledRunSpeed * 1.3f) < .001f, "pursuit ratio updates live " + handle.Result.name);
                settings.ChaseSpeedRatio.Value = 1.1f; engine.ChaseSpeed.Restore(police.Id);
                Check(Math.Abs(animator.speed - savedAnimationSpeed) < .001f && Math.Abs(patrol.agent.speed - savedAgentSpeed) < .001f,
                    "pursuit releases animation and agent overrides " + handle.Result.name);
                // Measure animated bones separately from the actor transform: an unchanged
                // actor Y does not imply that its visible body stayed above the ground.
                var bones = root.GetComponentsInChildren<SkinnedMeshRenderer>(true).SelectMany(s => s.bones).Where(b => b != null).GroupBy(b => b.Pointer).Select(g => g.First()).ToArray();
                float[] BoneHeights() => bones.Select(b => b.position.y - root.transform.position.y).ToArray();
                var runningPose = BoneHeights();
                character.transform.position = root.transform.position + Vector3.forward;
                Check(engine.TryCapture(police), "legal near target starts capture through live eligibility checks " + handle.Result.name);
                var action = engine.Captures[police.Id];
                var captureRims = root.GetComponentsInChildren<SkinnedMeshRenderer>(true).SelectMany(r => r.sharedMaterials)
                    .Where(m => m != null && m.name.StartsWith("ChasePrototype_RimOverlay_")).ToArray();
                Check(captureRims.Length > 0 && captureRims.All(m => m.GetColor("_RimColor").r > .9f && m.GetColor("_RimColor").g < .01f),
                    "capture playback uses red native Fresnel " + handle.Result.name);
                if (handle.Result.name == "police") SavePink(root, captureRed: true);
                Check(action.Settings.MoveScale == 1 && action.Settings.TurnSpeed == 900 && Math.Abs(action.Settings.CommitAt - .295f) < .0001f, "live light capture uses simulator timing " + handle.Result.name);
                engine.EndCapture(action, "legacy-fixture");
                int glowBuilds = action.Visual.GlowBuildCount;
                action = engine.StartCapture(police, character, LegacyCapture());
                Check(action.Visual.GlowBuildCount == glowBuilds, "capture reuses prebuilt overlay materials " + handle.Result.name);
                var origin = root.transform.position;
                // Unity does not evaluate disabled animators; advance only enabled ones.
                for (int i = 0; i < 25; i++) if (animator.enabled) animator.Update(.02f);
                log.LogInfo($"POSE DIAGNOSTIC {handle.Result.name}: min-running={runningPose.Min():F3} min-held={BoneHeights().Min():F3} max-bone-y-change={runningPose.Zip(BoneHeights(), (a, b) => Math.Abs(a-b)).Max():F3} root-y={root.transform.position.y:F3}");
                Check(Vector3.Distance(root.transform.position, origin) < .001f, "actual police root displacement stopped " + handle.Result.name);
                Check(!animator.enabled && animator.applyRootMotion, "windup pauses animator without changing root-motion settings " + handle.Result.name);
                Check(runningPose.Zip(BoneHeights(), (a, b) => Math.Abs(a-b)).Max() < .001f, "capture retains visible bone heights " + handle.Result.name);
                Check(animator.GetLayerWeight(owner.runLayerIndex) == 1, "capture preserves locomotion layer weights " + handle.Result.name);
                character.transform.position = root.transform.position + Vector3.right;
                engine.AdvanceCapture(action, .1f);
                Check(Vector3.Angle(Vector3.forward, action.Direction) <= 18.1f, "early turn obeys angular speed " + handle.Result.name);
                engine.AdvanceCapture(action, .1f);
                var committed = action.Direction;
                character.transform.position = root.transform.position + Vector3.back;
                engine.AdvanceCapture(action, .35f);
                Check(action.Phase == CapturePhase.Recovery && action.Direction == committed, "locked direction yields rear miss " + handle.Result.name);
                engine.AdvanceCapture(action, .4f);
                Check(engine.Captures.ContainsKey(police.Id), "miss recovery cannot end early " + handle.Result.name);
                engine.AdvanceCapture(action, .46f);
                Check(!engine.Captures.ContainsKey(police.Id) && animator.applyRootMotion && animator.enabled, "miss restores animation playback " + handle.Result.name);

                root.transform.rotation = Quaternion.identity; character.transform.position = root.transform.position + Vector3.forward;
                engine.DodgePhase = DodgePhase.Dash; engine.DodgeSettings = settings.Dodge(); engine.DodgeElapsed = .05f; engine.ProtectionUsed = false;
                action = engine.StartCapture(police, character, LegacyCapture());
                engine.AdvanceCapture(action, .55f);
                Check(action.Phase == CapturePhase.Recovery && engine.ProtectionUsed, "valid contact consumes perfect protection " + handle.Result.name);
                Check(!engine.Protect(action), "perfect window cannot block a second instance " + handle.Result.name);
                engine.ClearCaptures("test"); engine.StopDodge("test");
                settings.Debug.Value = true;
                action = engine.StartCapture(police, character, LegacyCapture()); engine.LateTick();
                var debugLines = UnityEngine.Object.FindObjectsOfType<LineRenderer>().Where(l => l.name == "ChasePrototype_DebugLine").ToArray();
                Check(action.Visual.RangeObjects.Count(o => o.GetComponent<LineRenderer>() != null) == 1, "F7 does not add debug sectors " + handle.Result.name);
                if (handle.Result.name == "police") SaveVisual(root, action);
                var points = Presentation.Arc(Vector3.zero, Vector3.forward, 2, 90);
                Check(Math.Abs(points[1].magnitude - 2) < .001f && Math.Abs(Vector3.Angle(points[1], Vector3.forward) - 45) < .001f,
                    "drawn fan equals actual radius and full angle " + handle.Result.name);
                settings.Debug.Value = false; engine.LateTick();
                Check(action.Visual.HasRange, "windup hit range visible with F7 debug off " + handle.Result.name);
                settings.Debug.Value = true; settings.ShowAttackRange.Value = false; engine.LateTick();
                Check(!action.Visual.HasRange, "attack range toggle hides normal telegraph " + handle.Result.name);
                settings.ShowAttackRange.Value = true;
                character.transform.position = root.transform.position + Vector3.back * 3;
                engine.AdvanceCapture(action, .3f); engine.LateTick();
                Check(action.Phase == CapturePhase.Recovery && !action.Visual.HasRange, "normal telegraph clears on recovery " + handle.Result.name);
                engine.EndCapture(action, "test"); settings.Debug.Value = false;

                character.transform.position = root.transform.position + Vector3.forward;
                action = engine.StartCapture(police, character, LegacyCapture());
                beforeArrest = arrested; engine.AdvanceCapture(action, .55f);
                Check(arrested == beforeArrest + 1, "native Arrest result entry invoked once " + handle.Result.name);
                engine.AdvanceCapture(action, .55f);
                Check(arrested == beforeArrest + 1, "resolved action cannot double Arrest " + handle.Result.name);
                engine.Reset("next-fixture");
            }
            CheckMovingCaptures(engine, settings, actors[0], character);
            // One perfect protection must not turn into immunity against the second police.
            var first = actors[0]; var second = actors[2];
            first.Owner.transform.rotation = second.Owner.transform.rotation = Quaternion.identity;
            second.Owner.transform.position = first.Owner.transform.position;
            character.transform.position = first.Owner.transform.position + Vector3.forward;
            var firstAction = engine.StartCapture(first, character, LegacyCapture());
            var secondAction = engine.StartCapture(second, character, LegacyCapture());
            engine.DodgeSettings = settings.Dodge(); engine.DodgePhase = DodgePhase.Dash; engine.DodgeElapsed = .05f; engine.ProtectionUsed = false;
            int beforeMultiArrest = arrested;
            engine.AdvanceCapture(firstAction, .55f); engine.AdvanceCapture(secondAction, .55f);
            Check(engine.ProtectionUsed && arrested == beforeMultiArrest + 1, "two police share only one perfect protection");
            engine.AdvanceCapture(firstAction, 1); engine.AdvanceCapture(secondAction, 1);
            Check(arrested == beforeMultiArrest + 1 && engine.Captures.Count == 0, "same-frame result clears all actions and stays unique");
            engine.Reset("multi-test");
            character.transform.position = first.Owner.transform.position + Vector3.back;
            firstAction = engine.StartCapture(first, character, LegacyCapture());
            engine.DodgeSettings = settings.Dodge(); engine.DodgePhase = DodgePhase.Dash; engine.DodgeElapsed = .05f; engine.ProtectionUsed = false;
            engine.AdvanceCapture(firstAction, .55f);
            Check(!engine.ProtectionUsed && firstAction.Phase == CapturePhase.Recovery, "positional miss does not consume perfect protection");
            engine.Reset("positional-miss");
            character.transform.position = first.Owner.transform.position + Vector3.forward;
            firstAction = engine.StartCapture(first, character, LegacyCapture());
            engine.AdvanceCapture(firstAction, 0);
            Check(firstAction.Elapsed == 0, "paused capture time stays frozen");
            settings.Windup.Value = .8f;
            Check(firstAction.Settings.Windup == .3f, "active capture retains parameter snapshot");
            settings.Windup.Value = .3f;
            first.Owner.enabled = false; engine.AdvanceCapture(firstAction, .1f);
            Check(engine.Captures.Count == 0 && firstAction.Animator!.applyRootMotion, "disabled entity cancels and restores root motion");
            first.Owner.enabled = true;
            // Check custom occlusion with a real collider, without touching scene save state.
            var obstacle = GameObject.CreatePrimitive(PrimitiveType.Cube); roots.Add(obstacle);
            obstacle.transform.position = new Vector3(0, .9f, 1); obstacle.transform.localScale = new Vector3(2, 2, .2f);
            var blockerRoot = new GameObject("ChaseOcclusionPolice"); blockerRoot.SetActive(false); roots.Add(blockerRoot);
            var blocker = blockerRoot.AddComponent<PoliceStateControl>(); blocker.enabled = false;
            character.transform.position = new Vector3(0, 0, 2); Physics.SyncTransforms();
            Check(engine.Occluded(blocker, settings.Capture() with { ObstacleMask = 1 }), "wall blocks actual raycast hit");
            obstacle.transform.position = new Vector3(20, .9f, 1); Physics.SyncTransforms();
            Check(!engine.Occluded(blocker, settings.Capture() with { ObstacleMask = 1 }), "clear line remains hittable");

            var costRow = settings.Rows.Single(r => r.Entry.Definition.Key == "StaminaCost");
            costRow.Text = "NaN"; Check(settings.Apply().StartsWith("非法参数"), "panel rejects non-finite input"); settings.Refresh();
            var radiusRow = settings.Rows.Single(r => r.Group == "Capture" && r.Entry.Definition.Key == "TriggerRadius");
            radiusRow.Text = "-3"; float oldRadius = settings.TriggerRadius.Value;
            Check(settings.Apply().StartsWith("非法参数") && settings.TriggerRadius.Value == oldRadius, "invalid cross-field radius rolls back atomically");
            settings.Refresh(); costRow.Text = "17"; Check(settings.Apply().StartsWith("已应用"), "valid panel edits apply");
            var reloaded = new Settings(new ConfigFile(file.ConfigFilePath, false)); Check(reloaded.Cost.Value == 17, "independent config reload persists");
            settings.Dash.Value = .03f; settings.WindowDuration.Value = .2f;
            var shortDodge = settings.Dodge();
            Check(Rules.Validate(shortDodge, settings.Capture()) == null && shortDodge.WindowEnd == shortDodge.Startup + shortDodge.Dash,
                "short dash clips perfect duration instead of rejecting unrelated edits");
            settings.WindowDuration.Value = 0;
            Check(!Rules.Window(settings.Dodge().WindowStart, settings.Dodge()), "zero perfect duration disables protection");
            // Migration must preserve player choices and stop writing retired keys.
            string migrationPath = Path.Combine(Paths.GameRootPath, "MyLilliaMods/artifacts/migration-test.cfg");
            File.WriteAllText(migrationPath, "[Dodge]\nStaminaCost = 0\nSpeed = 18\nDashSeconds = 0.4\nPerfectStartSeconds = 0.1\nPerfectEndSeconds = 0.25\n[Visual]\nRedR = 0.5\n");
            var migrated = new Settings(new ConfigFile(migrationPath, false));
            Check(migrated.Cost.Value == 0 && migrated.Speed.Value == 2 && Math.Abs(migrated.WindowDuration.Value - .15f) < .0001f,
                "legacy config migrates window duration and preserves gameplay edits");
            string migratedText = File.ReadAllText(migrationPath);
            Check(!migratedText.Contains("PerfectStartSeconds") && !migratedText.Contains("PerfectEndSeconds") && !migratedText.Contains("RedR"),
                "retired entries are removed from serialized config");
            Check(!AppDomain.CurrentDomain.GetAssemblies().Any(a => a.GetName().Name == "LilliaSystem") ||
                !typeof(Prototype).Assembly.GetReferencedAssemblies().Any(a => a.Name == "LilliaSystem"), "prototype has no System assembly dependency");
        }
        finally
        {
            engine.Reset("test-cleanup"); Prototype.Engine = originalEngine; Prototype.Options = originalSettings;
            foreach (var root in roots) UnityEngine.Object.Destroy(root);
        }
    }
    private static void CheckRunPlayback(Engine engine, Settings settings, List<GameObject> roots)
    {
        var previousCharacter = engine.Character;
        var parent = new GameObject("ChaseRunAnimationFixture"); parent.SetActive(false); roots.Add(parent);
        var root = UnityEngine.Object.Instantiate(playerPrefab.Result, parent.transform, false);
        foreach (var script in root.GetComponentsInChildren<MonoBehaviour>(true)) script.enabled = false;
        foreach (var collider in root.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
        var character = root.GetComponentInChildren<Character>(true);
        var animator = root.GetComponentInChildren<Animator>(true); character.anim = animator;
        var state = character.GetComponent<MainCharStateControl>() ?? character.gameObject.AddComponent<MainCharStateControl>();
        state.enabled = false; state.MaxStamina = 100; state.CurrentStamina = 100;
        character._movementEnabled = true; character.IsRunning = true; character._locomotionMode = 1;
        character._moveInputVector = Vector3.forward;
        root.transform.rotation = Quaternion.identity;
        var motor = character.Motor ?? character.GetComponent<KinematicCharacterMotor>();
        character.Motor = motor; motor.enabled = false;
        log.LogInfo($"GEOMETRY real-player capsule-radius={motor.CapsuleRadius:F4} scale={character.transform.lossyScale}");
        motor._characterUp = Vector3.up; motor._transientRotation = Quaternion.identity;
        motor.GroundingStatus = new CharacterGroundingReport { IsStableOnGround = true, FoundAnyGround = true,
            GroundNormal = Vector3.up, InnerGroundNormal = Vector3.up, OuterGroundNormal = Vector3.up };
        parent.SetActive(true); animator.cullingMode = AnimatorCullingMode.AlwaysAnimate; animator.Rebind(); animator.Update(0);
        engine.Character = character;
        ConfigEntry<double>? globalEntry = null;
        if (IL2CPPChainloader.Instance.Plugins.TryGetValue("com.yourname.lilliasystem", out var info) && info.Instance is BasePlugin plugin)
            plugin.Config.TryGetEntry("Movement", "RunSpeedMultiplier", out globalEntry);
        double oldGlobal = globalEntry?.Value ?? 1;
        bool oldAutoSave = globalEntry?.ConfigFile.SaveOnConfigSet ?? false;
        if (globalEntry != null) globalEntry.ConfigFile.SaveOnConfigSet = false;
        float originalAnimatorSpeed = animator.speed;
        var originalController = animator.runtimeAnimatorController;
        try
        {
            // Compare actual native grounded motion against the selected root-motion clip.
            if (globalEntry != null) globalEntry.Value = 1;
            engine.DodgeAnimation.Prepare(character);
            Check(engine.DodgeAnimation.Clip?.name == "Run", "real heroine running clip selected");
            engine.DodgeAnimation.Play(0);
            float rateSum = 0;
            for (int i = 0; i < 200; i++)
            {
                engine.DodgeAnimation.Evaluate(.02f);
                character._pendingRootMotionLocalDelta = animator.deltaPosition;
                Vector3 velocity = Vector3.zero; character.UpdateVelocity(ref velocity, .02f);
                rateSum += Vector3.ProjectOnPlane(velocity, Vector3.up).magnitude;
            }
            log.LogInfo($"PLAYER NATIVE RUN measured={rateSum/200:F3} clip-scaled={engine.DodgeAnimation.ScaledRunSpeed:F3} field-max={character.MaxRunSpeed:F3} human-scale={animator.humanScale:F4} lossy-scale={animator.transform.lossyScale}");
            Check(Math.Abs(rateSum/200 - engine.DodgeAnimation.ScaledRunSpeed) < .05f, "resolved run speed matches actual native grounded locomotion");
            engine.DodgeAnimation.Stop();
            var runClip = engine.DodgeAnimation.Clip;
            var walkClip = animator.runtimeAnimatorController.animationClips.First(c => c.name.Equals("Walk", StringComparison.OrdinalIgnoreCase));
            engine.DodgeAnimation.Clip = walkClip; character.IsRunning = false;
            engine.DodgeAnimation.Play(0);
            float walkSum = 0;
            for (int i = 0; i < 200; i++)
            {
                engine.DodgeAnimation.Evaluate(.02f);
                character._pendingRootMotionLocalDelta = animator.deltaPosition;
                Vector3 velocity = Vector3.zero; character.UpdateVelocity(ref velocity, .02f);
                walkSum += Vector3.ProjectOnPlane(velocity, Vector3.up).magnitude;
            }
            log.LogInfo($"PLAYER NATIVE WALK measured={walkSum/200:F4} raw={engine.DodgeAnimation.BaseWalkSpeed:F4} global={engine.DodgeAnimation.GlobalWalkMultiplier:F1}; RUN raw={engine.DodgeAnimation.BaseRunSpeed:F4} global2={engine.DodgeAnimation.BaseRunSpeed*2:F4}");
            Check(Math.Abs(walkSum/200 - engine.DodgeAnimation.BaseWalkSpeed * engine.DodgeAnimation.GlobalWalkMultiplier) < .05f,
                "measured walking matches root displacement with current global walk scale");
            engine.DodgeAnimation.Stop(); engine.DodgeAnimation.Clip = runClip; character.IsRunning = true;
            foreach (var parameter in animator.parameters) log.LogInfo($"HEROINE ANIM PARAM {parameter.name} {parameter.type}");
            foreach (int mode in new[] { 0, 1, 2, 3 })
            {
                animator.SetInteger("LocomotionMode", mode); animator.SetFloat("Speed", 1);
                animator.SetFloat("LocomotionPlaybackRate", 1); animator.SetFloat("RunLoopPlaybackRate", 1);
                for (int i = 0; i < 100; i++) animator.Update(.02f);
                for (int layer = 0; layer < animator.layerCount; layer++)
                    log.LogInfo($"NATIVE LOCOMOTION mode={mode} layer={layer}:{animator.GetLayerName(layer)} hash={animator.GetCurrentAnimatorStateInfo(layer).fullPathHash} short={animator.GetCurrentAnimatorStateInfo(layer).shortNameHash} clips=[{string.Join(",", animator.GetCurrentAnimatorClipInfo(layer).Select(c => c.clip?.name))}]");
            }
            int runHash = Animator.StringToHash("Run");
            int runLayer = Enumerable.Range(0, animator.layerCount).First(l => animator.HasState(l, runHash));
            Check(runLayer == 1, "native heroine Run state is on Walk layer");
            animator.SetInteger("LocomotionMode", 2); animator.SetLayerWeight(runLayer, 1);
            for (int i = 0; i < 100; i++) animator.Update(.02f);
            animator.Play(runHash, runLayer, .37f); animator.Update(0);
            state.CurrentStamina = 80;
            Check(engine.TryDodge(true), "phase continuity fixture starts");
            Check(Math.Abs(engine.DodgeAnimation.PlaybackPhase - .37f) < .005f, "dodge enters at current native running phase");
            engine.DodgeAnimation.Evaluate(.55f);
            var phaseBones = root.GetComponentsInChildren<SkinnedMeshRenderer>(true).SelectMany(r => r.bones).Where(b => b != null).GroupBy(b => b.Pointer).Select(g => g.First()).ToArray();
            var beforeBones = phaseBones.Select(b => b.localPosition).ToArray();
            float exitPhase = engine.DodgeAnimation.PlaybackPhase;
            engine.AdvanceDodge(.55f);
            float boneJump = beforeBones.Zip(phaseBones.Select(b => b.localPosition), Vector3.Distance).DefaultIfEmpty(0).Max();
            log.LogInfo($"RUN HANDOFF phase={exitPhase:F4} native={animator.GetCurrentAnimatorStateInfo(runLayer).normalizedTime:F4} max-bone-local-jump={boneJump:F5}");
            Check(!engine.DodgeAnimation.Active && engine.DodgeAnimation.HandoffAligned &&
                Math.Abs(animator.GetCurrentAnimatorStateInfo(runLayer).normalizedTime % 1 - exitPhase) < .005f,
                "550ms release seeks native Run to final dodge loop phase");
            Check(boneJump < .025f, "phase handoff keeps actual bone positions continuous");
            engine.StopDodge("phase-fixture-cleanup");
            var stableSource = root.GetComponentsInChildren<SkinnedMeshRenderer>(true)
                .First(r => r.sharedMaterials.Any(m => m != null && m.HasProperty("_RimColor")));
            var beforeWhite = stableSource.sharedMaterials.ToArray();
            var baselineColor = beforeWhite[0].GetColor("_RimColor");
            state.CurrentStamina = 100; Check(engine.TryDodge(true), "stable Fresnel playback fixture starts");
            int stableBuilds = engine.DodgeVisual.GlowBuildCount;
            var stableMaterials = stableSource.sharedMaterials.ToArray();
            var stableColor = stableMaterials[0].GetColor("_RimColor");
            for (int frame = 0; frame < 8; frame++)
            {
                engine.AdvanceDodge(.04f); engine.LateTick();
                Check(stableSource.sharedMaterials[0].Pointer == stableMaterials[0].Pointer &&
                    stableSource.sharedMaterials[0].GetColor("_RimColor") == stableColor,
                    "ordinary Fresnel remains steady without brightness pulses frame " + frame);
            }
            float ColorDistance(Color a, Color b) => Math.Abs(a.r-b.r)+Math.Abs(a.g-b.g)+Math.Abs(a.b-b.b)+Math.Abs(a.a-b.a);
            float previousDifference = ColorDistance(stableColor, baselineColor);
            foreach (float time in new[] { .48f, .52f, .549f })
            {
                engine.AdvanceDodge(time - engine.DodgeElapsed); engine.LateTick();
                var material = stableSource.sharedMaterials[0];
                float difference = ColorDistance(material.GetColor("_RimColor"), baselineColor);
                Check(material.Pointer == stableMaterials[0].Pointer && difference < previousDifference,
                    "Fresnel fades toward original appearance without material replacement " + time);
                previousDifference = difference;
            }
            engine.AdvanceDodge(.0011f);
            Check(!engine.DodgeVisual.HasGlow && previousDifference < .001f && engine.DodgeVisual.GlowBuildCount == stableBuilds,
                "fade completes at 550ms without any effect rebuilds");
            engine.StopDodge("stable-fade-fixture-cleanup");
            state.CurrentStamina = 80;
            var surfaceRenderers = root.GetComponentsInChildren<SkinnedMeshRenderer>(true).ToArray();
            var originalMaterials = surfaceRenderers.SelectMany(r => r.sharedMaterials).Select(m => m?.Pointer ?? IntPtr.Zero).ToArray();
            Check(engine.TryDodge(true), "pink success flash fixture starts");
            int overlayBuilds = engine.DodgeVisual.GlowBuildCount;
            var white = engine.DodgeVisual.GlowColor;
            Check(engine.DodgeVisual.HasGlow && Math.Abs(white.r - white.g) < .001f, "ordinary dodge uses white overlay");
            engine.AdvanceDodge(.05f);
            Check(engine.Protect(new CaptureAction()), "pink flash requires actual perfect protection");
            engine.LateTick(); var pink = engine.DodgeVisual.GlowColor;
            Check(Math.Abs(pink.r-1) < .001f && Math.Abs(pink.g-102f/255) < .001f && Math.Abs(pink.b-182f/255) < .001f,
                "perfect contact uses reference pink RGB 255 102 182");
            Check(pink.r <= 1 && pink.b <= 1 && pink.a <= .55f, "perfect color preserves chroma without HDR clipping");
            SavePink(character.gameObject);
            engine.AdvanceDodge(0); Check(engine.PerfectFlashRemaining == .3f, "paused perfect flash does not expire");
            engine.AdvanceDodge(.25f); engine.LateTick();
            Check(engine.DodgePhase == DodgePhase.Ready && engine.DodgeVisual.HasGlow, "success flash remains visible after shortened perfect action");
            engine.AdvanceDodge(.06f);
            Check(engine.PerfectFlashRemaining == 0 && !engine.DodgeVisual.HasGlow, "pink success flash clears after 300ms");
            Check(originalMaterials.SequenceEqual(surfaceRenderers.SelectMany(r => r.sharedMaterials).Select(m => m?.Pointer ?? IntPtr.Zero)),
                "effect completion restores original material references");
            state.CurrentStamina = 80; engine.TryDodge(true); engine.AdvanceDodge(.05f); engine.Protect(new CaptureAction());
            Check(engine.DodgeVisual.GlowBuildCount == overlayBuilds, "consecutive dodges reuse native rim materials");
            engine.StopDodge("cancelled-external-state");
            Check(engine.PerfectFlashRemaining == 0 && !engine.DodgeVisual.HasGlow, "cancellation clears pink flash immediately");
            var instancedSource = surfaceRenderers.First(r => r.sharedMaterials.Any(m => m != null && m.HasProperty("_UseRim")));
            var baseline = instancedSource.sharedMaterials.ToArray();
            state.CurrentStamina = 80; Check(engine.TryDodge(true), "renderer material-instance cleanup fixture starts");
            var cachedEffectMaterials = instancedSource.sharedMaterials.ToArray();
            var instancedMaterials = instancedSource.materials.ToArray();
            var nativeCopy = new Material(instancedMaterials[0]) { name = cachedEffectMaterials[0].name + " (Instance)" };
            instancedMaterials[0] = nativeCopy; instancedSource.sharedMaterials = instancedMaterials;
            engine.AdvanceDodge(.05f); Check(engine.Protect(new CaptureAction()), "instanced material perfect fixture succeeds");
            Check(Math.Abs(nativeCopy.GetColor("_RimColor").g-102f/255) < .001f && Math.Abs(nativeCopy.GetColor("_RimColor").b-182f/255) < .001f,
                "perfect success switches renderer-instantiated material from white to pink");
            engine.StopDodge("material-instance-test");
            log.LogInfo($"RIM CLEANUP original-border={baseline[0].GetFloat("_RimBorder")} copy-border={nativeCopy.GetFloat("_RimBorder")} original-color={baseline[0].GetColor("_RimColor")} copy-color={nativeCopy.GetColor("_RimColor")}");
            Check(Math.Abs(nativeCopy.GetFloat("_RimBorder") - baseline[0].GetFloat("_RimBorder")) < .0001f &&
                nativeCopy.GetColor("_RimColor") == baseline[0].GetColor("_RimColor"),
                "ending effect restores copied material rim shape and color");
            Check(nativeCopy.GetFloat("_UseRim") == baseline[0].GetFloat("_UseRim"),
                "ending effect clears rim in renderer-instantiated material copies");
            Check(cachedEffectMaterials[0].GetFloat("_UseRim") == baseline[0].GetFloat("_UseRim"),
                "ending effect disables cached materials even when another system retains them");
            Check(cachedEffectMaterials[0].GetFloat("_RimBorder") == baseline[0].GetFloat("_RimBorder") &&
                cachedEffectMaterials[0].GetColor("_RimColor") == baseline[0].GetColor("_RimColor"), "cached effect material cannot resurrect its tint");
            instancedSource.sharedMaterials = baseline; UnityEngine.Object.Destroy(nativeCopy);
            foreach (float global in globalEntry != null ? new[] { 1f, 2f, 3f, 0f } : new[] { 1f })
            {
                if (globalEntry != null) globalEntry.Value = global;
                state.CurrentStamina = 100;
                Check(engine.TryDodge(true) && Math.Abs(engine.DodgeSettings.Speed - engine.DodgeAnimation.BaseRunSpeed * global * 2) < .001f,
                    "dodge uses current global run scale exactly once " + global);
                engine.AdvanceDodge(.05f);
                float normalRate = Math.Max(1, global / 2);
                Check(engine.DodgeAnimation.Active && Math.Abs(engine.DodgeAnimation.PlaybackRate - normalRate) < .001f,
                    "run clip keeps normal global animation rate without dodge multiplier " + global);
                Check(animator.speed == originalAnimatorSpeed && animator.runtimeAnimatorController.Pointer == originalController.Pointer,
                    "temporary run playback preserves native animator speed and controller " + global);
                float SampleRootRate(float speed)
                {
                    animator.speed = speed; float distance = 0;
                    for (int i = 0; i < 100; i++) { engine.DodgeAnimation.Evaluate(.02f); distance += Vector3.ProjectOnPlane(animator.deltaPosition, Vector3.up).magnitude; }
                    return distance / 2;
                }
                float first = SampleRootRate(1), second = SampleRootRate(3);
                log.LogInfo($"DODGE CLIP RATE global={global} rate={engine.DodgeAnimation.PlaybackRate:F3} animator1-root={first:F3} animator3-root={second:F3}");
                Check(first > .1f && Math.Abs(first-second) < first * .08f,
                    "external Animator.speed does not compound playable rate " + global);
                animator.speed = originalAnimatorSpeed;
                engine.AdvanceDodge(.3f);
                Check(engine.DodgePhase == DodgePhase.Recovery && engine.DodgeAnimation.Active && engine.DodgeSettings.RecoveryScale == 0,
                    "run animation continues into linear recovery " + global);
                character._moveInputVector = Vector3.zero;
                Vector3 stationary = Vector3.forward * 10; character.UpdateVelocity(ref stationary, .02f);
                Check(Vector3.ProjectOnPlane(stationary, Vector3.up).magnitude < .001f, "continued run visual cannot move stationary recovery " + global);
                character._moveInputVector = Vector3.right;
                Vector3 recoveryMove = Vector3.zero; character.UpdateVelocity(ref recoveryMove, .02f);
                Check(Math.Abs(recoveryMove.x - engine.DodgeAnimation.ScaledRunSpeed * Rules.RecoveryMoveScale(engine.DodgeElapsed, engine.DodgeSettings)) < .001f,
                    "animated recovery follows current input and linear speed " + global);
                character._moveInputVector = Vector3.forward;
                engine.AdvanceDodge(.199f);
                Check(engine.DodgeAnimation.Active, "run animation remains active before 550ms " + global);
                Check(engine.DodgeVisual.HasGlow, "ordinary Fresnel follows active dodge animation " + global);
                engine.AdvanceDodge(.0011f);
                Check(!engine.DodgeAnimation.Active && engine.DodgePhase == DodgePhase.Recovery,
                    "run animation releases at 550ms while recovery continues " + global);
                Check(!engine.DodgeVisual.HasGlow && !root.GetComponentsInChildren<SkinnedMeshRenderer>(true).SelectMany(r => r.sharedMaterials)
                    .Any(m => m != null && m.name.StartsWith("ChasePrototype_RimOverlay_")), "550ms animation release restores ordinary Fresnel materials " + global);
                engine.StopDodge("run-test");
            }
            float oldDodgeMultiplier = settings.Speed.Value;
            settings.Speed.Value = 5; state.CurrentStamina = 100;
            Check(engine.TryDodge(true), "different dodge multiplier fixture starts"); engine.AdvanceDodge(.05f);
            Check(Math.Abs(engine.DodgeAnimation.PlaybackRate - Math.Max(1, engine.DodgeAnimation.GlobalMultiplier / 2)) < .001f,
                "changing dodge movement multiplier leaves normal run animation rate unchanged");
            engine.StopDodge("multiplier-animation-test"); settings.Speed.Value = oldDodgeMultiplier;
            state.CurrentStamina = 100;
            Check(engine.TryDodge(true), "animation cancellation fixture starts"); engine.AdvanceDodge(.05f);
            engine.StopDodge("cancelled-external-state");
            Check(!engine.DodgeAnimation.Active && animator.speed == originalAnimatorSpeed, "cancellation releases temporary animation");
        }
        finally
        {
            engine.StopDodge("run-test-cleanup"); animator.speed = originalAnimatorSpeed;
            engine.Character = previousCharacter;
            if (globalEntry != null) { globalEntry.Value = oldGlobal; globalEntry.ConfigFile.SaveOnConfigSet = oldAutoSave; }
        }
    }
    private static void CheckMovingCaptures(Engine engine, Settings settings, Police police, Character character)
    {
        var sources = new Il2CppSystem.Collections.Generic.List<NavMeshBuildSource>();
        sources.Add(new NavMeshBuildSource { shape = NavMeshBuildSourceShape.Box, size = new Vector3(30, 1, 30),
            transform = Matrix4x4.TRS(new Vector3(400, -.5f, 400), Quaternion.identity, Vector3.one), area = 0 });
        var build = NavMesh.GetSettingsByIndex(0);
        var data = NavMeshBuilder.BuildNavMeshData(build, sources, new Bounds(new Vector3(400, 0, 400), new Vector3(30, 10, 30)), Vector3.zero, Quaternion.identity);
        Check(data != null, "isolated navigation surface built");
        var instance = NavMesh.AddNavMeshData(data);
        var root = police.Owner.transform;
        var agent = police.Owner.GetComponent<NavMeshAgent>(); police.Owner.agent = agent;
        bool enabled = agent.enabled; Vector3 original = root.position;
        try
        {
            agent.agentTypeID = build.agentTypeID; root.position = new Vector3(400, 0, 400); agent.enabled = true;
            Check(agent.Warp(root.position) && agent.isOnNavMesh, "capture fixture is on real navigation surface");
            foreach (var kind in new[] { CaptureKind.Light, CaptureKind.Heavy })
            {
                engine.Reset("moving-fixture"); agent.Warp(new Vector3(400, 0, 400)); root.rotation = Quaternion.identity;
                character.transform.position = root.position + Vector3.forward * 20;
                var action = engine.StartCapture(police, character, settings.Capture(kind));
                Check(action.RunAnimation.Active && !action.Animator!.applyRootMotion, "moving capture owns run visual without duplicate root movement " + kind);
                float speed = action.MoveSpeed;
                var start = root.position;
                for (int i = 0; i < 10; i++) engine.AdvanceCapture(action, .02f);
                Check(Math.Abs(Vector3.Distance(start, root.position) - speed * .2f) < .03f, "capture advances at simulator speed from first frame " + kind);
                character.transform.position = root.position + new Vector3(1, 0, 10);
                var direction = action.Direction; engine.AdvanceCapture(action, .02f);
                Check(Vector3.Angle(direction, action.Direction) <= action.Settings.TurnSpeed * .02f + .01f,
                    "moving capture obeys finite steering " + kind);
                engine.AdvanceCapture(action, 2);
                Check(action.Phase == CapturePhase.Recovery && !action.RunAnimation.Active, "long frame moves only through windup and resolves once " + kind);
                var stopped = root.position; var facing = root.rotation;
                engine.AdvanceCapture(action, 1.49f); engine.LateTick();
                Check(engine.Captures.ContainsKey(police.Id) && root.position == stopped && root.rotation == facing, "1500ms recovery holds position and final facing " + kind);
                engine.AdvanceCapture(action, .02f);
                Check(!engine.Captures.ContainsKey(police.Id) && action.Animator!.applyRootMotion, "recovery restores native root motion " + kind);
                Check(!engine.TryCapture(police), "post-recovery cooldown blocks immediate restart " + kind);
            }
            engine.Reset("contact-fixture"); agent.Warp(new Vector3(400, 0, 400)); root.rotation = Quaternion.identity;
            character.transform.position = root.position + Vector3.forward * 1.4f;
            var contact = engine.StartCapture(police, character, settings.Capture(CaptureKind.Heavy));
            engine.AdvanceCapture(contact, .59f);
            Check(Vector3.Distance(root.position, character.transform.position) >= agent.radius + character.Motor.CapsuleRadius - .005f,
                "heavy continuous advance stops at player body contact");
            Check(contact.Phase != CapturePhase.Recovery, "heavy does not resolve before 600ms");
            engine.Reset("wall-fixture"); agent.Warp(new Vector3(400, 0, 400)); root.rotation = Quaternion.identity;
            character.transform.position = root.position + Vector3.forward * 20;
            var wall = GameObject.CreatePrimitive(PrimitiveType.Cube);
            try
            {
                wall.transform.position = new Vector3(400, 1, 401.5f); wall.transform.localScale = new Vector3(4, 2, .2f); Physics.SyncTransforms();
                var blocked = engine.StartCapture(police, character, settings.Capture(CaptureKind.Heavy) with { ObstacleMask = 1 });
                engine.AdvanceCapture(blocked, .59f);
                Check(root.position.z > 400 && root.position.z < 401.5f - agent.radius,
                    "continuous capture capsule stops before wall without tunneling");
            }
            finally { UnityEngine.Object.Destroy(wall); }
        }
        finally
        {
            engine.Reset("navigation-cleanup"); agent.enabled = enabled; root.position = original;
            NavMesh.RemoveNavMeshData(instance); UnityEngine.Object.Destroy(data);
        }
    }
    private static void CheckActualMotor(Engine engine, GameObject fixture, Character character, KinematicCharacterMotor motor, List<GameObject> roots)
    {
        var floor = GameObject.CreatePrimitive(PrimitiveType.Cube); roots.Add(floor);
        floor.transform.position = new Vector3(300, -.5f, 300); floor.transform.localScale = new Vector3(20, 1, 20);
        var wall = GameObject.CreatePrimitive(PrimitiveType.Cube); roots.Add(wall);
        wall.transform.position = new Vector3(320, 1, 301.2f); wall.transform.localScale = new Vector3(4, 3, .2f);
        fixture.SetActive(true); character.enabled = false; motor.enabled = false;
        motor.CharacterController = character.Cast<ICharacterController>();
        motor.SetCapsuleDimensions(.3f, 1.8f, .9f);
        motor.CollidableLayers = 1; motor.InteractiveRigidbodyHandling = false;
        character.Gravity = new Vector3(0, -30, 0);
        var motors = new Il2CppSystem.Collections.Generic.List<KinematicCharacterMotor>(); motors.Add(motor);
        var movers = new Il2CppSystem.Collections.Generic.List<PhysicsMover>();
        float Sample(bool blocked)
        {
            motor.SetPositionAndRotation(new Vector3(300, .01f, 300), Quaternion.identity);
            wall.transform.position = new Vector3(blocked ? 300 : 320, 1, 301.2f); Physics.SyncTransforms();
            engine.DodgeSettings = Prototype.Options.Dodge() with { Speed = 10 }; engine.DodgePhase = DodgePhase.Dash; engine.DodgeElapsed = .05f; engine.DodgeDirection = Vector3.forward;
            for (int i = 0; i < 10; i++) KinematicCharacterSystem.Simulate(.02f, motors, movers);
            float moved = fixture.transform.position.z - 300;
            log.LogInfo($"MOTOR displacement blocked={blocked} distance={moved:F3}");
            engine.StopDodge("motor-test"); return moved;
        }
        float free = Sample(false), blockedDistance = Sample(true);
        Check(free > 1.7f && free < 2.2f, "real KinematicCharacterMotor advances dash position");
        Check(blockedDistance < 1 && blockedDistance >= 0, "real KinematicCharacterMotor blocks wall traversal");
        fixture.SetActive(false); character.transform.position = Vector3.zero;
        motor.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
        motor.GroundingStatus = new CharacterGroundingReport { IsStableOnGround = true, FoundAnyGround = true,
            GroundNormal = Vector3.up, InnerGroundNormal = Vector3.up, OuterGroundNormal = Vector3.up };
    }
    private static void SavePink(GameObject root, bool captureRed = false)
    {
        var layers = root.GetComponentsInChildren<Transform>(true).Select(t => (Object: t.gameObject, Layer: t.gameObject.layer)).ToArray();
        var cameraObject = new GameObject("PerfectPinkCamera"); var camera = cameraObject.AddComponent<Camera>();
        var texture = new RenderTexture(640, 640, 24); var pixels = new Texture2D(640, 640, TextureFormat.RGB24, false);
        var previous = RenderTexture.active;
        try
        {
            foreach (var entry in layers) entry.Object.layer = 30;
            camera.cullingMask = 1 << 30; camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = Color.black;
            var visible = root.GetComponentsInChildren<SkinnedMeshRenderer>().Where(r => r.enabled && !r.name.StartsWith("ChasePrototype_")).ToArray();
            var bounds = visible[0].bounds;
            foreach (var renderer in visible.Skip(1)) bounds.Encapsulate(renderer.bounds);
            foreach (var renderer in visible)
            {
                log.LogInfo($"PINK RENDERER {renderer.name} bounds={renderer.bounds} vertices={renderer.sharedMesh.vertexCount} readable={renderer.sharedMesh.isReadable}");
                foreach (var material in renderer.sharedMaterials.Where(m => m != null))
                    log.LogInfo($"OVERLAY SHADER {material.shader.name} properties=" + string.Join(",", Enumerable.Range(0, material.shader.GetPropertyCount()).Select(i => material.shader.GetPropertyName(i)).Where(p => p.Contains("Rim", StringComparison.OrdinalIgnoreCase) || p.Contains("Fresnel", StringComparison.OrdinalIgnoreCase) || p.Contains("MainTex") || p.Contains("BaseMap"))));
            }
            camera.transform.position = bounds.center + Vector3.forward * Math.Max(.4f, bounds.size.magnitude * 1.3f);
            camera.transform.LookAt(bounds.center);
            camera.fieldOfView = 12;
            Check(!root.GetComponentsInChildren<Transform>(true).Any(t => t.name == "ChasePrototype_GlowShell"),
                "GPU Fresnel uses original renderers without an expanded shell");
            Check(visible.SelectMany(r => r.sharedMaterials).Any(m => m != null && m.name.StartsWith("ChasePrototype_RimOverlay_") && m.GetFloat("_UseRim") == 1),
                "native shader Fresnel is enabled on material copies");
            camera.targetTexture = texture; camera.Render(); RenderTexture.active = texture;
            pixels.ReadPixels(new Rect(0, 0, 640, 640), 0, 0); pixels.Apply();
            int colored = pixels.GetPixels32().Count(p => captureRed
                ? p.r > 50 && p.r > p.g * 1.2f && p.r > p.b * 1.2f
                : p.r > 50 && p.r > p.g * 1.1f && p.b > p.g * 1.05f);
            log.LogInfo($"{(captureRed ? "CAPTURE RED" : "PERFECT PINK")} PIXELS={colored}");
            File.WriteAllBytes(Path.Combine(Paths.GameRootPath, $"MyLilliaMods/artifacts/{(captureRed ? "capture-red-rim" : "perfect-pink")}.png"), ImageConversion.EncodeToPNG(pixels).ToArray());
            Check(colored > 50, captureRed ? "capture playback produces visible red Fresnel pixels on real police render" : "perfect feedback produces visible pink pixels on real heroine render");
        }
        finally
        {
            foreach (var entry in layers) entry.Object.layer = entry.Layer;
            RenderTexture.active = previous; camera.targetTexture = null;
            UnityEngine.Object.Destroy(cameraObject); UnityEngine.Object.Destroy(texture); UnityEngine.Object.Destroy(pixels);
        }
    }
    private static void SaveVisual(GameObject root, CaptureAction action)
    {
        var obj = new GameObject("ChaseVisualTestCamera");
        var camera = obj.AddComponent<Camera>();
        var texture = new RenderTexture(960, 720, 24);
        var pixels = new Texture2D(960, 720, TextureFormat.RGB24, false);
        var original = RenderTexture.active;
        var floor = GameObject.CreatePrimitive(PrimitiveType.Cube);
        var originalLayers = action.Visual.RangeObjects.Select(o => (Object: o, Layer: o.layer)).ToArray();
        try
        {
            floor.transform.position = root.transform.position + Vector3.down * .38f;
            floor.transform.localScale = new Vector3(8, 1, 8); floor.layer = 30; Physics.SyncTransforms();
            // Reproject the range over a surface above the actor's root position.
            action.Visual.Sector(root.transform.position, action.Direction, action.Settings, true, root.transform);
            foreach (var range in action.Visual.RangeObjects) range.layer = 30;
            foreach (var line in action.Visual.RangeObjects.Select(o => o.GetComponent<LineRenderer>()).Where(l => l != null && l.enabled))
                Check(Enumerable.Range(0, line.positionCount).All(i => line.GetPosition(i).y > root.transform.position.y + .19f),
                    "range vertices are lifted onto actual raised floor");
            camera.cullingMask = 1 << 30;
            camera.transform.position = root.transform.position + new Vector3(5, 6, -5);
            camera.transform.LookAt(root.transform.position + new Vector3(0, .5f, .5f));
            camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = new Color(.06f, .07f, .09f);
            camera.targetTexture = texture; camera.Render();
            RenderTexture.active = texture; pixels.ReadPixels(new Rect(0, 0, 960, 720), 0, 0); pixels.Apply();
            int red = pixels.GetPixels32().Count(p => p.r > 50 && p.r > p.g * 1.5f && p.r > p.b * 1.5f);
            int yellow = pixels.GetPixels32().Count(p => p.r > 80 && p.g > 80 && p.b < p.r * .4f);
            log.LogInfo($"RANGE PIXELS red={red} yellow={yellow}; isolated geometry camera");
            Check(red > 200 && yellow > 20, "actual rendered attack and trigger ranges contain visible colored pixels");
            var bytes = ImageConversion.EncodeToPNG(pixels);
            File.WriteAllBytes(Path.Combine(Paths.GameRootPath, "MyLilliaMods/artifacts/capture-sector.png"), bytes.ToArray());
            Check(bytes.Length > 2000, "graphics sector screenshot saved");
        }
        finally
        {
            RenderTexture.active = original; camera.targetTexture = null;
            foreach (var entry in originalLayers) if (entry.Object != null) entry.Object.layer = entry.Layer;
            UnityEngine.Object.Destroy(floor);
            UnityEngine.Object.Destroy(obj); UnityEngine.Object.Destroy(texture); UnityEngine.Object.Destroy(pixels);
        }
    }
}

public sealed class GuiProbe : MonoBehaviour
{
    private int repaints;
    private Settings? originalSettings, guiSettings;
    private readonly Engine poseEngine = new();
    private readonly List<GameObject> poseRoots = new();
    private readonly List<(GameObject Root, Transform[] Bones, float[] Heights)> poses = new();
    public GuiProbe(IntPtr pointer) : base(pointer) { }
    private void Tab(string name) => Panel.CanvasObject!.transform.Find("Parameters/Tab_" + name).GetComponent<UnityEngine.UI.Button>().onClick.Invoke();
    private UnityEngine.UI.InputField Field(string key) => Panel.CanvasObject!.GetComponentsInChildren<UnityEngine.UI.InputField>()
        .Last(f => f.gameObject.name == "Value_" + key);
    private void StartPoseChecks()
    {
        var targetRoot = new GameObject("ChasePoseTarget"); targetRoot.SetActive(false); poseRoots.Add(targetRoot);
        var target = targetRoot.AddComponent<Character>(); target.enabled = false;
        foreach (var prefab in Checks.Prefabs)
        {
            var parent = new GameObject("ChasePoseFrames_" + prefab.name); parent.SetActive(false); poseRoots.Add(parent);
            var root = UnityEngine.Object.Instantiate(prefab, parent.transform, false);
            foreach (var script in root.GetComponentsInChildren<MonoBehaviour>(true)) script.enabled = false;
            foreach (var agent in root.GetComponentsInChildren<NavMeshAgent>(true)) agent.enabled = false;
            foreach (var collider in root.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
            var owner = root.GetComponent<DefaultCharacterControl>(); owner.anim = root.GetComponent<Animator>();
            parent.SetActive(true);
            owner.anim.cullingMode = AnimatorCullingMode.AlwaysAnimate; owner.anim.Rebind(); owner.anim.Update(0);
            owner.anim.SetLayerWeight(owner.runLayerIndex, 1); owner.anim.SetFloat("Speed", 1);
            for (int i = 0; i < 80; i++) owner.anim.Update(.02f);
            var bones = root.GetComponentsInChildren<SkinnedMeshRenderer>(true).SelectMany(s => s.bones).Where(b => b != null)
                .GroupBy(b => b.Pointer).Select(g => g.First()).ToArray();
            poses.Add((root, bones, bones.Select(b => b.position.y - root.transform.position.y).ToArray()));
            poseEngine.StartCapture(new Police(owner), target, guiSettings!.Capture() with { MoveScale = 0 });
        }
    }
    private void Cleanup()
    {
        poseEngine.Reset("gui-test-cleanup");
        foreach (var root in poseRoots) UnityEngine.Object.Destroy(root);
        poseRoots.Clear(); poses.Clear();
        if (originalSettings != null) Prototype.Options = originalSettings;
        Panel.Dispose();
    }
    public void LateUpdate()
    {
        if (Checks.GuiPassed) return;
        try
        {
            if (repaints == 0)
            {
                originalSettings = Prototype.Options;
                guiSettings = new Settings(new ConfigFile(Path.Combine(Paths.GameRootPath, "MyLilliaMods/artifacts/gui-test.cfg"), false));
                guiSettings.Apply(true); Panel.Dispose(); Prototype.Options = guiSettings;
                StartPoseChecks();
            }
            Panel.Tick(true); poseEngine.LateTick();
            if (Panel.CanvasObject == null) return;
            if (++repaints == 1)
            {
                Tab("Dodge");
                return;
            }
            if (repaints == 2)
            {
                Field("RunSpeedMultiplier").text = "3";
                Checks.GuiCheck(guiSettings!.Rows.Single(r => r.Entry.Definition.Key == "RunSpeedMultiplier").Text == "3", "native InputField event stages speed edit");
                Field("DashSeconds").SetTextWithoutNotify("0.03");
                Field("RecoverySeconds").SetTextWithoutNotify("1.1");
                Field("PerfectWindowSeconds").SetTextWithoutNotify("0.09");
                Field("StaminaCost").SetTextWithoutNotify("7");
                Tab("Capture"); return;
            }
            if (repaints == 3)
            {
                Field("WindupSeconds").SetTextWithoutNotify("0.7");
                Tab("Heavy");
                Field("Chance").SetTextWithoutNotify("0.25");
                Field("WindupSeconds").SetTextWithoutNotify("0.9");
                Panel.CanvasObject.transform.Find("Parameters/Apply").GetComponent<UnityEngine.UI.Button>().onClick.Invoke();
                var saved = new Settings(new ConfigFile(guiSettings!.File.ConfigFilePath, false));
                Checks.GuiCheck(saved.Speed.Value == 3 && saved.Dash.Value == .03f && saved.Recovery.Value == 1.1f &&
                    saved.Cost.Value == 7 && saved.WindowDuration.Value == .09f && saved.Windup.Value == .7f &&
                    saved.HeavyChance.Value == .25f && saved.HeavyWindup.Value == .9f,
                    "native panel edits across tabs serialize and reload all gameplay values");
                Tab("Dodge"); return;
            }
            if (repaints == 4)
            {
                Checks.GuiCheck(Field("RunSpeedMultiplier").text == "3" && Field("DashSeconds").text == "0.03", "panel shows applied values after switching back");
                // Exercise actual action snapshots after a native UI save.
                var target = poseRoots[0].GetComponent<Character>();
                var state = poseRoots[0].AddComponent<MainCharStateControl>(); state.enabled = false; state.CurrentStamina = 80;
                poseEngine.Character = target;
                Checks.GuiCheck(poseEngine.TryDodge(true) && Math.Abs(poseEngine.DodgeSettings.Speed - poseEngine.DodgeAnimation.ScaledRunSpeed * 3) < .001f && poseEngine.DodgeSettings.Dash == .03f &&
                    poseEngine.DodgeSettings.Recovery == 1.1f && state.CurrentStamina == 73, "next dodge uses saved speed timing and cost");
                poseEngine.StopDodge("gui-snapshot");
                foreach (var pose in poses)
                    Checks.GuiCheck(pose.Heights.Zip(pose.Bones.Select(b => b.position.y - pose.Root.transform.position.y), (a,b) => Math.Abs(a-b)).Max() < .001f,
                        "real Unity frames preserve held police bone heights " + pose.Root.name);
                // The reload control must reread disk, rather than merely repaint memory.
                string disk = File.ReadAllText(guiSettings!.File.ConfigFilePath).Replace("RunSpeedMultiplier = 3", "RunSpeedMultiplier = 4");
                File.WriteAllText(guiSettings.File.ConfigFilePath, disk);
                Panel.CanvasObject.transform.Find("Parameters/Reload").GetComponent<UnityEngine.UI.Button>().onClick.Invoke();
                Checks.GuiCheck(guiSettings.Speed.Value == 4 && Field("RunSpeedMultiplier").text == "4", "native reload button reads external disk changes");
                Tab("Capture"); return;
            }
            if (repaints < 6) return;
            var canvas = Panel.CanvasObject.GetComponent<Canvas>();
            var cameraObject = new GameObject("ChasePanelTestCamera"); var camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true; camera.orthographicSize = 450; camera.cullingMask = 1 << 29;
            camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = new Color(.03f, .03f, .04f);
            var texture = new RenderTexture(1280, 900, 24); var pixels = new Texture2D(1280, 900, TextureFormat.RGB24, false);
            var old = RenderTexture.active;
            try
            {
                foreach (var tr in Panel.CanvasObject.GetComponentsInChildren<Transform>(true)) tr.gameObject.layer = 29;
                camera.targetTexture = texture;
                canvas.renderMode = RenderMode.ScreenSpaceCamera; canvas.worldCamera = camera; canvas.planeDistance = 1;
                Canvas.ForceUpdateCanvases(); camera.Render();
                RenderTexture.active = texture; pixels.ReadPixels(new Rect(0, 0, 1280, 900), 0, 0); pixels.Apply();
                int visible = pixels.GetPixels32().Count(p => p.r > 32 && p.g > 32 && p.b > 32);
                Checks.GuiCheck(visible > 5000, "panel capture has visible rendered pixels");
                var labels = Panel.CanvasObject.GetComponentsInChildren<UnityEngine.UI.Text>().Select(t => t.text).ToArray();
                Checks.GuiCheck(labels.Contains("命中半径 m"), "native tab click selects capture parameters");
                File.WriteAllBytes(Checks.GuiPath, ImageConversion.EncodeToPNG(pixels).ToArray()); Checks.GuiPassed = true;
            }
            finally
            {
                canvas.renderMode = RenderMode.ScreenSpaceOverlay; canvas.worldCamera = null;
                RenderTexture.active = old; UnityEngine.Object.Destroy(cameraObject); UnityEngine.Object.Destroy(texture); UnityEngine.Object.Destroy(pixels);
            }
            Cleanup();
        }
        catch (Exception ex) { Cleanup(); Checks.GuiFailure(ex); }
    }
}
