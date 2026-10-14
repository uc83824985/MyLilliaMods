using UnityEngine;
using UnityEngine.Rendering;

namespace LilliaChasePrototype;

internal sealed class Presentation
{
    private sealed record Overlay(SkinnedMeshRenderer Source, Mesh Mesh, Material[] Original, Material[] Active);
    private readonly List<Overlay> overlays = new();
    private static int nextEffectOwner;
    private readonly int effectOwner = ++nextEffectOwner;
    private static readonly (string Key, float Value)[] RimSettings = {
        ("_UseRim", 1), ("_RimFresnelPower", 3), ("_RimBorder", .15f), ("_RimBlur", .7f),
        ("_RimEnableLighting", 0), ("_RimShadowMask", 0), ("_RimBackfaceMask", 1),
        ("_RimApplyTransparency", 1), ("_RimDirStrength", 0), ("_RimMainStrength", 0), ("_RimBlendMode", 0) };
    private readonly List<LineRenderer> lines = new();
    private bool glowActive;
    private Color glowColor;
    internal int GlowBuildCount;
    internal float GlowWeight;
    internal static float FadeWeight(float secondsRemaining)
    {
        float t = Math.Clamp(secondsRemaining / .08f, 0, 1);
        return t * t * (3 - 2 * t);
    }
    private static readonly Il2CppInterop.Runtime.InteropTypes.Arrays.Il2CppStructArray<RaycastHit> groundHits = new(32);
    private Material? lineMaterial;
    private GameObject? rangeObject;
    private Mesh? rangeMesh;
    private Material? rangeMaterial;
    private static readonly HashSet<string> Reported = new();
    internal bool HasGlow => glowActive && overlays.Count > 0;
    internal Color GlowColor => glowColor;
    internal bool HasRange => lines.Any(l => l != null && l.enabled);
    internal IEnumerable<GameObject> RangeObjects => lines.Where(l => l != null).Select(l => l.gameObject)
        .Concat(rangeObject != null ? new[] { rangeObject } : Array.Empty<GameObject>());
    private static Shader? ShaderForVisuals()
    {
        foreach (string name in new[] { "Sprites/Default", "Unlit/Color", "UI/Default" })
        { var shader = Shader.Find(name); if (shader != null && shader.isSupported) return shader; }
        return null;
    }
    internal void Glow(Component owner, Color color, float intensity)
    {
        var sources = owner.GetComponentsInChildren<SkinnedMeshRenderer>(true).Where(source =>
            source.enabled && source.gameObject.activeInHierarchy && source.sharedMesh != null).ToArray();
        bool reusable = overlays.Count == sources.Length && sources.All(source => overlays.Any(o =>
            o.Source != null && o.Source.Pointer == source.Pointer && o.Mesh != null && o.Mesh.Pointer == source.sharedMesh.Pointer &&
            source.sharedMaterials.Length == o.Original.Length && source.sharedMaterials.Select((m, i) =>
                m == o.Original[i] || m == o.Active[i]).All(match => match)));
        if (!reusable)
        {
            DisposeGlow(); GlowBuildCount++;
            Plugin.Log.LogInfo($"[Visual] rim-material-cache rebuild={GlowBuildCount} owner={owner.name} renderers={sources.Length}");
            foreach (var source in sources)
            {
                var original = source.sharedMaterials.ToArray();
                var active = original.ToArray();
                for (int i = 0; i < original.Length; i++)
                {
                    var material = original[i];
                    if (material == null || !material.HasProperty("_UseRim") || !material.HasProperty("_RimColor"))
                    { if (material != null) Report("rim-shader:" + material.shader.name, "材质不支持原生菲涅尔，保留原材质：" + material.shader.name); continue; }
                    var overlay = new Material(material) { name = $"ChasePrototype_RimOverlay_{effectOwner}_{overlays.Count}_{i}" };
                    active[i] = overlay;
                }
                overlays.Add(new Overlay(source, source.sharedMesh, original, active));
            }
        }
        foreach (var overlay in overlays)
        {
            for (int i = 0; i < overlay.Active.Length; i++)
                if (overlay.Active[i] != null && overlay.Active[i] != overlay.Original[i])
                {
                    foreach (var setting in RimSettings)
                        if (overlay.Active[i].HasProperty(setting.Key)) overlay.Active[i].SetFloat(setting.Key, setting.Value);
                    if (overlay.Active[i].HasProperty("_RimColorTex")) overlay.Active[i].SetTexture("_RimColorTex", Texture2D.whiteTexture);
                }
            if (overlay.Source != null) overlay.Source.sharedMaterials = overlay.Active;
        }
        glowActive = true; SetGlow(color, intensity);
    }
    internal void SetGlow(Color color, float intensity, float alpha = .45f, float weight = 1)
    {
        if (!glowActive) return;
        color.a = Math.Min(.55f, alpha) * Math.Clamp(intensity, 0, 1);
        glowColor = color;
        GlowWeight = Math.Clamp(weight, 0, 1);
        foreach (var overlay in overlays)
        {
            for (int i = 0; i < overlay.Active.Length; i++)
                if (overlay.Active[i] != null && overlay.Active[i] != overlay.Original[i]) BlendRim(overlay.Active[i], overlay.Original[i], color, GlowWeight);
            if (overlay.Source == null) continue;
            var current = overlay.Source.sharedMaterials;
            for (int i = 0; i < Math.Min(current.Length, overlay.Active.Length); i++)
                if (OwnedInstance(current[i], overlay.Active[i], overlay.Original[i]) && current[i] != overlay.Active[i])
                    BlendRim(current[i], overlay.Original[i], color, GlowWeight);
        }
    }
    private static void BlendRim(Material material, Material original, Color color, float weight)
    {
        if (weight >= 1) { material.SetColor("_RimColor", color); return; }
        if (weight <= 0) { RestoreRim(material, original); return; }
        var baseline = original.GetColor("_RimColor");
        if (original.GetFloat("_UseRim") == 0) baseline.a = 0;
        material.SetColor("_RimColor", Color.Lerp(baseline, color, weight));
        foreach (var setting in RimSettings)
            if (setting.Key is "_RimBorder" or "_RimBlur" or "_RimFresnelPower")
                if (material.HasProperty(setting.Key) && original.HasProperty(setting.Key))
                    material.SetFloat(setting.Key, Mathf.Lerp(original.GetFloat(setting.Key), setting.Value, weight));
    }
    private static bool OwnedInstance(Material? material, Material? active, Material? original)
        => material != null && active != null && active != original &&
            (material == active || material.name == active.name ||
             material.name.StartsWith(active.name + " (Instance)", StringComparison.Ordinal));
    private static void RestoreRim(Material material, Material original)
    {
        foreach (var setting in RimSettings)
            if (material.HasProperty(setting.Key) && original.HasProperty(setting.Key))
                material.SetFloat(setting.Key, original.GetFloat(setting.Key));
        if (material.HasProperty("_RimColor") && original.HasProperty("_RimColor")) material.SetColor("_RimColor", original.GetColor("_RimColor"));
        if (material.HasProperty("_RimColorTex") && original.HasProperty("_RimColorTex")) material.SetTexture("_RimColorTex", original.GetTexture("_RimColorTex"));
    }
    internal void Sector(Vector3 origin, Vector3 direction, CaptureSettings settings, bool debug = true, Transform? owner = null)
    {
        int count = debug ? 3 : 1;
        EnsureLines(count);
        if (lines.Count < count) return;
        origin += Vector3.up * Plugin.Options.DebugHeight.Value;
        foreach (var line in lines) line.enabled = false;
        var hitPoints = OnGround(Arc(origin, direction, settings.Radius, settings.Angle), owner);
        if (debug)
        {
            SetLine(lines[0], OnGround(Arc(origin, direction, settings.TriggerRadius, settings.TriggerAngle), owner), Color.yellow);
            SetLine(lines[1], hitPoints, Color.red);
            SetLine(lines[2], OnGround(new[] { origin, origin + direction.normalized * settings.Radius }, owner), Color.cyan);
        }
        else SetLine(lines[0], hitPoints, Color.red);
        Fill(hitPoints);
        if (owner != null) foreach (var obj in RangeObjects) obj.layer = owner.gameObject.layer;
    }

    private static Vector3[] OnGround(Vector3[] points, Transform? owner)
    {
        for (int i = 0; i < points.Length; i++)
        {
            float best = float.MaxValue, baseY = points[i].y - Plugin.Options.DebugHeight.Value;
            int hitCount = Physics.RaycastNonAlloc(points[i] + Vector3.up * 1.5f, Vector3.down, groundHits, 3, -1, QueryTriggerInteraction.Ignore);
            for (int hitIndex = 0; hitIndex < hitCount; hitIndex++)
            {
                var hit = groundHits[hitIndex];
                if (hit.collider == null || hit.normal.y < .5f ||
                    (owner != null && hit.collider.transform.IsChildOf(owner)) ||
                    hit.collider.GetComponentInParent<ProjectTarkovH.CharacterController>() != null ||
                    hit.collider.GetComponentInParent<DefaultCharacterControl>() != null) continue;
                float difference = Math.Abs(hit.point.y - baseY);
                if (difference >= best) continue;
                best = difference; points[i].y = hit.point.y + Plugin.Options.DebugHeight.Value;
            }
        }
        return points;
    }

    private void Fill(Vector3[] points)
    {
        if (rangeObject == null)
        {
            rangeObject = new GameObject("ChasePrototype_AttackRange");
            rangeMesh = new Mesh { name = "ChasePrototype_AttackRangeMesh" };
            rangeMaterial = new Material(lineMaterial!) { name = "ChasePrototype_AttackRangeMaterial", color = new Color(1, 0, 0, .18f) };
            rangeObject.AddComponent<MeshFilter>().sharedMesh = rangeMesh;
            var renderer = rangeObject.AddComponent<MeshRenderer>(); renderer.sharedMaterial = rangeMaterial;
            renderer.shadowCastingMode = ShadowCastingMode.Off; renderer.receiveShadows = false;
        }
        rangeMesh!.Clear(); rangeMesh.vertices = points;
        int segments = points.Length - 3;
        int[] triangles = new int[segments * 3];
        for (int i = 0; i < segments; i++) { triangles[i * 3] = 0; triangles[i * 3 + 1] = i + 1; triangles[i * 3 + 2] = i + 2; }
        rangeMesh.triangles = triangles; rangeMesh.RecalculateBounds();
    }
    internal void Direction(Vector3 origin, Vector3 direction, float length)
    {
        EnsureLines(1);
        if (lines.Count == 0) return;
        origin += Vector3.up * Plugin.Options.DebugHeight.Value;
        var end = origin + direction * length; var side = Vector3.Cross(Vector3.up, direction) * .15f;
        SetLine(lines[0], new[] { origin, end, end - direction * .3f + side, end, end - direction * .3f - side }, Color.white);
    }
    internal static Vector3[] Arc(Vector3 origin, Vector3 direction, float radius, float angle)
    {
        int count = Plugin.Options.ArcSegments.Value;
        var points = new Vector3[count + 3]; points[0] = origin;
        direction.y = 0; direction.Normalize();
        for (int i = 0; i <= count; i++)
            points[i + 1] = origin + Quaternion.AngleAxis(-angle * .5f + angle * i / count, Vector3.up) * direction * radius;
        points[^1] = origin; return points;
    }
    private void EnsureLines(int count)
    {
        if (lineMaterial == null)
        {
            var shader = ShaderForVisuals();
            if (shader == null) { Report("sector-shader", "扇形可视化待办：找不到可用着色器。判定参数和日志仍可用。"); return; }
            lineMaterial = new Material(shader) { color = Color.white, name = "ChasePrototype_Debug" };
        }
        while (lines.Count < count)
        {
            var obj = new GameObject("ChasePrototype_DebugLine");
            var line = obj.AddComponent<LineRenderer>(); line.sharedMaterial = lineMaterial;
            line.useWorldSpace = true; line.shadowCastingMode = ShadowCastingMode.Off; line.receiveShadows = false;
            lines.Add(line);
        }
    }
    private static void SetLine(LineRenderer line, Vector3[] points, Color color)
    {
        line.enabled = true;
        line.startWidth = line.endWidth = Plugin.Options.DebugWidth.Value;
        line.startColor = line.endColor = color; line.positionCount = points.Length; line.SetPositions(points);
    }
    internal void ClearLines()
    {
        foreach (var line in lines) if (line != null) { line.enabled = false; UnityEngine.Object.Destroy(line.gameObject); }
        lines.Clear(); if (lineMaterial != null) UnityEngine.Object.Destroy(lineMaterial); lineMaterial = null;
        if (rangeObject != null) { rangeObject.SetActive(false); UnityEngine.Object.Destroy(rangeObject); }
        if (rangeMesh != null) UnityEngine.Object.Destroy(rangeMesh);
        if (rangeMaterial != null) UnityEngine.Object.Destroy(rangeMaterial);
        rangeObject = null; rangeMesh = null; rangeMaterial = null;
    }
    internal void ClearGlow()
    {
        if (!glowActive) return;
        glowActive = false;
        GlowWeight = 0;
        foreach (var overlay in overlays)
        {
            if (overlay.Source == null) continue;
            var current = overlay.Source.sharedMaterials.ToArray(); bool changed = false;
            for (int i = 0; i < Math.Min(current.Length, overlay.Active.Length); i++)
                if (OwnedInstance(current[i], overlay.Active[i], overlay.Original[i]))
                {
                    if (current[i] == overlay.Active[i]) { current[i] = overlay.Original[i]; changed = true; }
                    else RestoreRim(current[i], overlay.Original[i]);
                }
            if (changed) overlay.Source.sharedMaterials = current;
        }
        // Another system may retain and reattach this array after the timer ends.
        foreach (var overlay in overlays)
            for (int i = 0; i < overlay.Active.Length; i++)
                if (overlay.Active[i] != null && overlay.Active[i] != overlay.Original[i]) RestoreRim(overlay.Active[i], overlay.Original[i]);
    }
    private void DisposeGlow()
    {
        ClearGlow();
        foreach (var overlay in overlays)
            for (int i = 0; i < overlay.Active.Length; i++)
                if (overlay.Active[i] != null && overlay.Active[i] != overlay.Original[i]) UnityEngine.Object.Destroy(overlay.Active[i]);
        overlays.Clear();
    }
    internal void Clear() { ClearGlow(); ClearLines(); }
    internal void Dispose() { DisposeGlow(); ClearLines(); }
    private static void Report(string key, string reason)
    { if (Reported.Add(key)) Plugin.Log.LogWarning("[Visual] " + reason); }
}

internal static class Animations
{
    private static readonly HashSet<string> Seen = new();
    private static readonly string[] GrabCandidates = { "Grab", "Catch", "Arrest", "Reach", "Base Layer.Grab", "Base Layer.Catch", "Base Layer.Arrest" };
    private static readonly string[] MissCandidates = { "GrabMiss", "CatchMiss", "Miss", "Base Layer.GrabMiss", "Base Layer.CatchMiss" };
    internal static void Attempt(CaptureAction action, bool miss)
    {
        if (!Plugin.Options.TryAnimation.Value || action.Animator == null) return;
        var animator = action.Animator;
        string controller = animator.runtimeAnimatorController != null ? animator.runtimeAnimatorController.name : "none";
        if (Seen.Add(controller + ":inventory") && animator.runtimeAnimatorController != null)
            Plugin.Log.LogInfo("[Animation] clip inventory " + controller + ": " + string.Join(", ", animator.runtimeAnimatorController.animationClips.Select(c => c.name)));
        string specified = miss ? Plugin.Options.MissState.Value : Plugin.Options.GrabState.Value;
        IEnumerable<string> candidates = specified.Length > 0 ? new[] { specified } : miss ? MissCandidates : GrabCandidates;
        foreach (string candidate in candidates)
        {
            string report = controller + ":" + candidate;
            int hash = Animator.StringToHash(candidate);
            bool exists = animator.HasState(0, hash);
            if (Seen.Add(report)) Plugin.Log.LogInfo($"[Animation] controller={controller} candidate={candidate} exists={exists}");
            if (!exists) continue;
            string shortName = candidate.Split('.').Last();
            var clip = animator.runtimeAnimatorController?.animationClips.FirstOrDefault(c => string.Equals(c.name, shortName, StringComparison.OrdinalIgnoreCase));
            if (clip == null || clip.isLooping || clip.events.Length != 0)
            {
                if (Seen.Add(report + ":unsafe")) Plugin.Log.LogWarning($"[Animation] state={candidate} skipped: clip mapping unavailable, looping or events present");
                continue;
            }
            // Change locomotion/root motion only after a compatible replacement is available.
            animator.enabled = action.WasAnimatorEnabled;
            animator.applyRootMotion = false;
            foreach (var layer in action.LayerWeights.Keys) animator.SetLayerWeight(layer, 0);
            animator.CrossFadeInFixedTime(hash, Plugin.Options.AnimationBlend.Value, 0);
            action.AnimationPlayed = true;
            Plugin.Log.LogInfo($"[Animation #{action.Number}] attempted state={candidate}; gameplay-clock-independent");
            return;
        }
        string key = controller + (miss ? ":miss-fallback" : ":grab-fallback");
        if (Seen.Add(key)) Plugin.Log.LogInfo($"[Animation] {key}: no compatible candidate state; red-light prototype retained");
    }
}
