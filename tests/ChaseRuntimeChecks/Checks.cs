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
            if (waitingGui && GuiPassed && File.Exists(GuiPath))
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
            RuntimeHost.PanelOpen = true;
            waitingGui = true; guiStart = Time.unscaledTime;
        }
        catch (Exception ex) { done = true; log.LogError("CHASE CHECK FAILED: " + ex); }
        finally { if (done && !waitingGui) Application.Quit(); }
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
        settings.File.SaveOnConfigSet = false;
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
            Check(engine.TryDodge(true) && state.CurrentStamina == 30, "dodge charges exactly once");
            Check(!engine.TryDodge(true) && state.CurrentStamina == 30, "repeated input cannot charge or restart");
            Check(NativeVelocity(1).magnitude < .001f, "native UpdateVelocity startup does not dash early");
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
            Check(state.CurrentStamina < 80 && director.runStamina == 4, "normal sprint stamina resumes with native/modded cost");
            character.IsRunning = false; state.CurrentStamina = 80;
            CheckActualMotor(engine, fixture, character, motor, roots);
            CheckRunPlayback(engine, settings, roots);

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
                // Measure animated bones separately from the actor transform: an unchanged
                // actor Y does not imply that its visible body stayed above the ground.
                var bones = root.GetComponentsInChildren<SkinnedMeshRenderer>(true).SelectMany(s => s.bones).Where(b => b != null).GroupBy(b => b.Pointer).Select(g => g.First()).ToArray();
                float[] BoneHeights() => bones.Select(b => b.position.y - root.transform.position.y).ToArray();
                var runningPose = BoneHeights();
                character.transform.position = root.transform.position + Vector3.forward;
                Check(engine.TryCapture(police), "legal near target starts capture through live eligibility checks " + handle.Result.name);
                var action = engine.Captures[police.Id];
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
                engine.DodgePhase = DodgePhase.Dash; engine.DodgeSettings = settings.Dodge(); engine.DodgeElapsed = .1f; engine.ProtectionUsed = false;
                action = engine.StartCapture(police, character, settings.Capture());
                engine.AdvanceCapture(action, .55f);
                Check(action.Phase == CapturePhase.Recovery && engine.ProtectionUsed, "valid contact consumes perfect protection " + handle.Result.name);
                Check(!engine.Protect(action), "perfect window cannot block a second instance " + handle.Result.name);
                engine.ClearCaptures("test"); engine.StopDodge("test");
                settings.Debug.Value = true;
                action = engine.StartCapture(police, character, settings.Capture()); engine.LateTick();
                var debugLines = UnityEngine.Object.FindObjectsOfType<LineRenderer>().Where(l => l.name == "ChasePrototype_DebugLine").ToArray();
                Check(debugLines.Length >= 3 && debugLines.All(l => l.positionCount >= 2), "runtime sector lines created " + handle.Result.name);
                if (handle.Result.name == "police") SaveVisual(root);
                var points = Presentation.Arc(Vector3.zero, Vector3.forward, 2, 90);
                Check(Math.Abs(points[1].magnitude - 2) < .001f && Math.Abs(Vector3.Angle(points[1], Vector3.forward) - 45) < .001f,
                    "drawn fan equals actual radius and full angle " + handle.Result.name);
                engine.EndCapture(action, "test"); settings.Debug.Value = false;

                character.transform.position = root.transform.position + Vector3.forward;
                action = engine.StartCapture(police, character, settings.Capture());
                beforeArrest = arrested; engine.AdvanceCapture(action, .55f);
                Check(arrested == beforeArrest + 1, "native Arrest result entry invoked once " + handle.Result.name);
                engine.AdvanceCapture(action, .55f);
                Check(arrested == beforeArrest + 1, "resolved action cannot double Arrest " + handle.Result.name);
                engine.Reset("next-fixture");
            }
            // One perfect protection must not turn into immunity against the second police.
            var first = actors[0]; var second = actors[2];
            first.Owner.transform.rotation = second.Owner.transform.rotation = Quaternion.identity;
            second.Owner.transform.position = first.Owner.transform.position;
            character.transform.position = first.Owner.transform.position + Vector3.forward;
            var firstAction = engine.StartCapture(first, character, settings.Capture());
            var secondAction = engine.StartCapture(second, character, settings.Capture());
            engine.DodgeSettings = settings.Dodge(); engine.DodgePhase = DodgePhase.Dash; engine.DodgeElapsed = .1f; engine.ProtectionUsed = false;
            int beforeMultiArrest = arrested;
            engine.AdvanceCapture(firstAction, .55f); engine.AdvanceCapture(secondAction, .55f);
            Check(engine.ProtectionUsed && arrested == beforeMultiArrest + 1, "two police share only one perfect protection");
            engine.AdvanceCapture(firstAction, 1); engine.AdvanceCapture(secondAction, 1);
            Check(arrested == beforeMultiArrest + 1 && engine.Captures.Count == 0, "same-frame result clears all actions and stays unique");
            engine.Reset("multi-test");
            character.transform.position = first.Owner.transform.position + Vector3.back;
            firstAction = engine.StartCapture(first, character, settings.Capture());
            engine.DodgeSettings = settings.Dodge(); engine.DodgePhase = DodgePhase.Dash; engine.DodgeElapsed = .1f; engine.ProtectionUsed = false;
            engine.AdvanceCapture(firstAction, .55f);
            Check(!engine.ProtectionUsed && firstAction.Phase == CapturePhase.Recovery, "positional miss does not consume perfect protection");
            engine.Reset("positional-miss");
            character.transform.position = first.Owner.transform.position + Vector3.forward;
            firstAction = engine.StartCapture(first, character, settings.Capture());
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
            var radiusRow = settings.Rows.Single(r => r.Entry.Definition.Key == "TriggerRadius");
            radiusRow.Text = "3"; float oldRadius = settings.TriggerRadius.Value;
            Check(settings.Apply().Contains("半径") && settings.TriggerRadius.Value == oldRadius, "invalid cross-field radius rolls back atomically");
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
                Check(engine.DodgePhase == DodgePhase.Recovery && !engine.DodgeAnimation.Active && engine.DodgeSettings.RecoveryScale == .1f,
                    "recovery restores native animation with configurable movement slow " + global);
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
            engine.DodgeSettings = Prototype.Options.Dodge() with { Speed = 10 }; engine.DodgePhase = DodgePhase.Dash; engine.DodgeElapsed = .1f; engine.DodgeDirection = Vector3.forward;
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
    private static void SaveVisual(GameObject root)
    {
        var obj = new GameObject("ChaseVisualTestCamera");
        var camera = obj.AddComponent<Camera>();
        var texture = new RenderTexture(960, 720, 24);
        var pixels = new Texture2D(960, 720, TextureFormat.RGB24, false);
        var original = RenderTexture.active;
        try
        {
            camera.transform.position = root.transform.position + new Vector3(5, 6, -5);
            camera.transform.LookAt(root.transform.position + new Vector3(0, .5f, .5f));
            camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = new Color(.06f, .07f, .09f);
            camera.targetTexture = texture; camera.Render();
            RenderTexture.active = texture; pixels.ReadPixels(new Rect(0, 0, 960, 720), 0, 0); pixels.Apply();
            var bytes = ImageConversion.EncodeToPNG(pixels);
            File.WriteAllBytes(Path.Combine(Paths.GameRootPath, "MyLilliaMods/artifacts/capture-sector.png"), bytes.ToArray());
            Check(bytes.Length > 2000, "graphics sector screenshot saved");
        }
        finally
        {
            RenderTexture.active = original; camera.targetTexture = null;
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
            poseEngine.StartCapture(new Police(owner), target, guiSettings!.Capture());
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
                Panel.CanvasObject.transform.Find("Parameters/Apply").GetComponent<UnityEngine.UI.Button>().onClick.Invoke();
                var saved = new Settings(new ConfigFile(guiSettings!.File.ConfigFilePath, false));
                Checks.GuiCheck(saved.Speed.Value == 3 && saved.Dash.Value == .03f && saved.Recovery.Value == 1.1f &&
                    saved.Cost.Value == 7 && saved.WindowDuration.Value == .09f && saved.Windup.Value == .7f,
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
