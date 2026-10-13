using UnityEngine;
using UnityEngine.Rendering;

namespace LilliaChasePrototype;

internal sealed class Presentation
{
    private readonly List<GameObject> glowObjects = new();
    private readonly List<Mesh> meshes = new();
    private readonly List<LineRenderer> lines = new();
    private Material? glowMaterial, lineMaterial;
    private static readonly HashSet<string> Reported = new();
    internal bool HasGlow => glowMaterial != null;
    private static Shader? ShaderForVisuals()
    {
        foreach (string name in new[] { "Sprites/Default", "Unlit/Color", "UI/Default" })
        { var shader = Shader.Find(name); if (shader != null && shader.isSupported) return shader; }
        return null;
    }
    internal void Glow(Component owner, Color color, float intensity)
    {
        ClearGlow();
        try
        {
            var shader = ShaderForVisuals();
            if (shader == null) { Report("glow-shader", "没有可用的基础着色器，红白光显示待办；逻辑继续运行。"); return; }
            glowMaterial = new Material(shader) { name = "ChasePrototype_Glow" };
            // Separate shells never overwrite the original renderer, shared materials or cloth.
            foreach (var source in owner.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (!source.enabled || !source.gameObject.activeInHierarchy || source.sharedMesh == null || source.name.StartsWith("ChasePrototype_")) continue;
                var obj = new GameObject("ChasePrototype_GlowShell");
                obj.transform.SetParent(source.transform, false);
                glowObjects.Add(obj);
                var renderer = obj.AddComponent<SkinnedMeshRenderer>();
                Mesh mesh = UnityEngine.Object.Instantiate(source.sharedMesh);
                meshes.Add(mesh);
                if (mesh.isReadable)
                {
                    var vertices = mesh.vertices; var normals = mesh.normals;
                    if (vertices.Length == normals.Length)
                        for (int i = 0; i < vertices.Length; i++) vertices[i] += normals[i] * Plugin.Options.GlowScale.Value;
                    mesh.vertices = vertices; mesh.RecalculateBounds();
                }
                renderer.sharedMesh = mesh; renderer.bones = source.bones; renderer.rootBone = source.rootBone;
                renderer.localBounds = source.localBounds;
                for (int i = 0; i < mesh.blendShapeCount; i++) renderer.SetBlendShapeWeight(i, source.GetBlendShapeWeight(i));
                renderer.updateWhenOffscreen = false;
                renderer.shadowCastingMode = ShadowCastingMode.Off; renderer.receiveShadows = false;
                renderer.sharedMaterials = Enumerable.Repeat(glowMaterial, Math.Max(1, mesh.subMeshCount)).ToArray();
            }
            if (glowObjects.Count == 0) Report("no-skinned-renderers:" + owner.name, "没有可用蒙皮网格：" + owner.name + "；红白光待办。扇形仍可显示。");
            SetGlow(color, intensity);
        }
        catch (Exception ex) { ClearGlow(); Report("glow-create", "光效创建失败，已清理；待办原因：" + ex); }
    }
    internal void SetGlow(Color color, float intensity)
    {
        if (glowMaterial == null) return;
        color.r *= intensity; color.g *= intensity; color.b *= intensity; color.a = .45f;
        glowMaterial.color = color;
    }
    internal void Sector(Vector3 origin, Vector3 direction, CaptureSettings settings)
    {
        EnsureLines(3);
        if (lines.Count < 3) return;
        origin += Vector3.up * Plugin.Options.DebugHeight.Value;
        SetLine(lines[0], Arc(origin, direction, settings.TriggerRadius, settings.TriggerAngle), Color.yellow);
        SetLine(lines[1], Arc(origin, direction, settings.Radius, settings.Angle), Color.red);
        SetLine(lines[2], new[] { origin, origin + direction.normalized * settings.Radius }, Color.cyan);
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
        line.startWidth = line.endWidth = Plugin.Options.DebugWidth.Value;
        line.startColor = line.endColor = color; line.positionCount = points.Length; line.SetPositions(points);
    }
    internal void ClearLines()
    {
        foreach (var line in lines) if (line != null) UnityEngine.Object.Destroy(line.gameObject);
        lines.Clear(); if (lineMaterial != null) UnityEngine.Object.Destroy(lineMaterial); lineMaterial = null;
    }
    internal void ClearGlow()
    {
        foreach (var obj in glowObjects) if (obj != null) UnityEngine.Object.Destroy(obj);
        foreach (var mesh in meshes) if (mesh != null) UnityEngine.Object.Destroy(mesh);
        glowObjects.Clear(); meshes.Clear();
        if (glowMaterial != null) UnityEngine.Object.Destroy(glowMaterial); glowMaterial = null;
    }
    internal void Clear() { ClearGlow(); ClearLines(); }
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
