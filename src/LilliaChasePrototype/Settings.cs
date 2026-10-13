using System.Globalization;
using BepInEx.Configuration;
using UnityEngine;

namespace LilliaChasePrototype;

internal sealed class Setting
{
    internal ConfigEntryBase Entry = null!;
    internal string Label = "";
    internal float Min, Max;
    internal string Text = "";
    internal string Group => Entry.Definition.Section;
    internal bool Parse(out object? value)
    {
        value = null;
        Type type = Entry.SettingType;
        if (type == typeof(string)) { value = Text; return true; }
        if (type == typeof(bool)) { if (bool.TryParse(Text, out bool b)) value = b; }
        else if (type == typeof(KeyCode)) { if (Enum.TryParse(Text, true, out KeyCode k) && Enum.IsDefined(typeof(KeyCode), k)) value = k; }
        else if (type == typeof(int)) { if (int.TryParse(Text, NumberStyles.Integer, CultureInfo.InvariantCulture, out int i) && i >= Min && i <= Max) value = i; }
        else if (float.TryParse(Text, NumberStyles.Float, CultureInfo.InvariantCulture, out float f) && float.IsFinite(f) && f >= Min && f <= Max) value = f;
        return value != null;
    }
    internal void Refresh() => Text = Convert.ToString(Entry.BoxedValue, CultureInfo.InvariantCulture) ?? "";
}

internal sealed class Settings
{
    internal sealed record Fixed<T>(T Value);
    internal readonly List<Setting> Rows = new();
    internal readonly ConfigFile File;
    internal ConfigEntry<bool> Enabled, CaptureEnabled, DodgeEnabled, Debug, Verbose;
    internal ConfigEntry<KeyCode> DodgeKey, PanelKey, DebugKey;
    internal ConfigEntry<float> TriggerRadius, TriggerAngle, Radius, Angle, Windup, MissRecovery,
        Cost, Dash, Speed, Recovery, RecoveryScale, WindowDuration;
    internal readonly Fixed<float> Startup = new(.04f), Height = new(1.2f), CommitAt = new(.2f), TurnSpeed = new(180),
        ProbeHeight = new(.9f), RedIntensity = new(2), WhiteIntensity = new(1), WindowIntensity = new(3),
        BlinkHz = new(9), GlowScale = new(.018f), DebugWidth = new(.025f), DebugHeight = new(.06f),
        ScanInterval = new(.25f), LogInterval = new(1), AnimationBlend = new(.08f);
    internal readonly Fixed<int> ObstacleMask = new(-1), ArcSegments = new(32);
    internal readonly Fixed<bool> TryAnimation = new(true);
    internal readonly Fixed<string> GrabState = new(""), MissState = new("");
    internal Color Red => Color.red;
    internal Color White => Color.white;

    internal Settings(ConfigFile file)
    {
        File = file;
        bool autoSave = File.SaveOnConfigSet; File.SaveOnConfigSet = false;
        // Retire old entries explicitly so BepInEx does not write them back as orphaned keys.
        string original = System.IO.File.Exists(File.ConfigFilePath) ? System.IO.File.ReadAllText(File.ConfigFilePath) : "";
        bool migrateWindow = !System.Text.RegularExpressions.Regex.IsMatch(original, @"(?m)^PerfectWindowSeconds\s*=") &&
            System.Text.RegularExpressions.Regex.IsMatch(original, @"(?m)^Perfect(?:Start|End)Seconds\s*=");
        float oldStart = Retire("Dodge", "PerfectStartSeconds", .08f);
        float oldEnd = Retire("Dodge", "PerfectEndSeconds", .14f);
        Retire("Dodge", "Speed", ""); // Old absolute m/s cannot be reused as a relative multiplier.
        foreach (var (section, key) in new[] {
            ("Dodge", "StartupSeconds"), ("Capture", "MaxHeightDifference"), ("Capture", "CommitStartSeconds"),
            ("Capture", "EarlyTurnDegreesPerSecond"), ("Technical", "ObstacleMask"), ("Technical", "OcclusionProbeHeight"),
            ("Technical", "PoliceScanInterval"), ("Visual", "RedIntensity"), ("Visual", "RedR"), ("Visual", "RedG"),
            ("Visual", "RedB"), ("Visual", "WhiteR"), ("Visual", "WhiteG"), ("Visual", "WhiteB"),
            ("Visual", "WhiteIntensity"), ("Visual", "PerfectIntensity"), ("Visual", "WhiteBlinkHz"), ("Visual", "GlowScale"),
            ("Debug", "ArcSegments"), ("Debug", "LineWidth"), ("Debug", "GroundOffset"), ("Logging", "SampleInterval"),
            ("Animation", "TryExistingAnimations"), ("Animation", "BlendSeconds"), ("Animation", "GrabState"), ("Animation", "MissState") })
            Retire(section, key, "");
        Enabled = Bool("General", "Enabled", true, "插件启用");
        CaptureEnabled = Bool("General", "CaptureEnabled", true, "接管警察抓捕");
        DodgeEnabled = Bool("General", "DodgeEnabled", true, "启用闪避");
        PanelKey = Key("General", "PanelKey", KeyCode.F6, "调参面板按键");
        DebugKey = Key("General", "DebugKey", KeyCode.F7, "调试显示按键");
        DodgeKey = Key("Dodge", "Key", KeyCode.Space, "闪避按键（None 禁用）");
        Cost = Number("Dodge", "StaminaCost", 50, 0, 10000, "体力消耗（原生点数）");
        Dash = Number("Dodge", "DashSeconds", .3f, .01f, 3, "突进时间 s");
        Speed = Number("Dodge", "RunSpeedMultiplier", 2, .1f, 100, "突进／全局缩放后的跑步速度倍率");
        Recovery = Number("Dodge", "RecoverySeconds", .6f, .01f, 5, "恢复时间 s");
        RecoveryScale = Number("Dodge", "RecoverySpeedScale", .1f, 0, 1, "恢复移动倍率");
        WindowDuration = Number("Dodge", "PerfectWindowSeconds", .06f, 0, 3, "完美窗口时长 s（限于突进内；0 关闭）");
        if (migrateWindow && float.IsFinite(oldEnd - oldStart) && oldEnd > oldStart)
        {
            WindowDuration.Value = Math.Clamp(oldEnd - oldStart, 0, 3);
            Plugin.Log.LogInfo($"[Config] 完美窗口迁移为时长 {WindowDuration.Value:F3}s；保留其他玩法参数。");
        }
        TriggerRadius = Number("Capture", "TriggerRadius", 1.8f, .05f, 20, "抓捕启动半径 m");
        TriggerAngle = Number("Capture", "TriggerFullAngle", 120, 1, 360, "启动完整扇形角 °");
        Radius = Number("Capture", "HitRadius", 2, .05f, 20, "命中半径 m");
        Angle = Number("Capture", "HitFullAngle", 90, 1, 360, "命中完整扇形角 °");
        Windup = Number("Capture", "WindupSeconds", .3f, .01f, 10, "前摇时间 s");
        MissRecovery = Number("Capture", "MissRecoverySeconds", .85f, .01f, 10, "扑空原地僵直 s");
        Debug = Bool("Debug", "ShowGeometry", false, "显示扇形／方向／时序");
        Verbose = Bool("Logging", "Verbose", false, "详细诊断日志");
        if (PanelKey.Value == KeyCode.None || PanelKey.Value == DebugKey.Value || PanelKey.Value == DodgeKey.Value ||
            (DebugKey.Value != KeyCode.None && DebugKey.Value == DodgeKey.Value))
        {
            PanelKey.Value = KeyCode.F6; DebugKey.Value = KeyCode.F7; DodgeKey.Value = KeyCode.Space;
            Plugin.Log.LogWarning("[Config] 插件按键重复或面板键无效，恢复 F6 / F7 / Space。");
        }
        var error = Rules.Validate(Dodge(), Capture());
        if (error != null)
        {
            Plugin.Log.LogWarning("[Config] " + error + " 仅修正启动半径。");
            TriggerRadius.Value = Math.Min(TriggerRadius.Value, Radius.Value);
        }
        File.Save(); File.SaveOnConfigSet = autoSave; Refresh();
    }

    private T Retire<T>(string section, string key, T fallback)
    {
        var entry = File.Bind(section, key, fallback); T old = entry.Value;
        File.Remove(entry.Definition); return old;
    }

    private ConfigEntry<float> Number(string group, string key, float value, float min, float max, string label)
    {
        var entry = File.Bind(group, key, value, new ConfigDescription(label, new AcceptableValueRange<float>(min, max)));
        if (!float.IsFinite(entry.Value) || entry.Value < min || entry.Value > max) entry.Value = value;
        Rows.Add(new Setting { Entry = entry, Label = label, Min = min, Max = max }); return entry;
    }
    private ConfigEntry<bool> Bool(string group, string key, bool value, string label)
    {
        var entry = File.Bind(group, key, value, label); Rows.Add(new Setting { Entry = entry, Label = label }); return entry;
    }
    private ConfigEntry<KeyCode> Key(string group, string key, KeyCode value, string label)
    {
        var entry = File.Bind(group, key, value, label); Rows.Add(new Setting { Entry = entry, Label = label }); return entry;
    }
    internal DodgeSettings Dodge(float scaledRunSpeed = 1)
    {
        // Preserve the original 0.04s delay into the dash. Short dashes shorten this delay
        // and clip the window, so adjusting dash duration no longer invalidates all edits.
        float start = Startup.Value + Math.Min(.04f, Dash.Value * .25f);
        float end = Math.Min(start + WindowDuration.Value, Startup.Value + Dash.Value);
        return new(Cost.Value, Startup.Value, Dash.Value, Speed.Value * scaledRunSpeed, Recovery.Value, RecoveryScale.Value, start, end);
    }
    internal CaptureSettings Capture() => new(TriggerRadius.Value, TriggerAngle.Value, Radius.Value, Angle.Value,
        Height.Value, Windup.Value, Math.Min(CommitAt.Value, Windup.Value * .5f), TurnSpeed.Value, MissRecovery.Value, ObstacleMask.Value, ProbeHeight.Value);
    internal void Refresh() { foreach (var row in Rows) row.Refresh(); }
    internal string Apply(bool defaults = false)
    {
        var parsed = new List<object>();
        foreach (var row in Rows)
        {
            if (defaults) parsed.Add(row.Entry.DefaultValue);
            else if (row.Parse(out var value)) parsed.Add(value!);
            else { Plugin.Log.LogWarning($"[Config] 拒绝保存 {row.Entry.Definition}: '{row.Text}'"); return "非法参数：" + row.Label; }
        }
        var old = Rows.Select(r => r.Entry.BoxedValue).ToArray();
        bool autoSave = File.SaveOnConfigSet; File.SaveOnConfigSet = false;
        try
        {
            for (int i = 0; i < Rows.Count; i++) Rows[i].Entry.BoxedValue = parsed[i];
            string? error = Rules.Validate(Dodge(), Capture());
            if (PanelKey.Value == KeyCode.None || PanelKey.Value == DebugKey.Value || PanelKey.Value == DodgeKey.Value ||
                (DebugKey.Value != KeyCode.None && DebugKey.Value == DodgeKey.Value)) error = "面板键必须有效，三个插件按键不能重复。";
            if (error != null)
            {
                for (int i = 0; i < Rows.Count; i++) Rows[i].Entry.BoxedValue = old[i];
                Plugin.Log.LogWarning("[Config] 拒绝保存：" + error);
                return error;
            }
            File.Save(); Refresh();
            string changes = string.Join(", ", Rows.Where((r, i) => !Equals(old[i], r.Entry.BoxedValue))
                .Select(r => $"{r.Group}.{r.Entry.Definition.Key}={r.Text}"));
            Plugin.Log.LogInfo($"[Config] 已保存 path={File.ConfigFilePath}; changes=[{changes}]; {DodgeSummary()}; 活动动作保留快照。");
            return "已应用并保存；下一次动作生效。\n" + DodgeSummary();
        }
        catch (Exception ex)
        {
            for (int i = 0; i < Rows.Count; i++) Rows[i].Entry.BoxedValue = old[i];
            Plugin.Log.LogError("[Config] 保存失败，内存参数已回退：" + ex);
            return "保存失败，参数已回退；参见日志。";
        }
        finally { File.SaveOnConfigSet = autoSave; }
    }
    internal string DodgeSummary() => $"闪避：跑速×{Speed.Value:F2}，突进 {Dash.Value:F3}s，后摇 {Recovery.Value:F3}s×{RecoveryScale.Value:F2}，完美窗 {WindowDuration.Value:F3}s，体力 {Cost.Value:F2}";
    internal string Reload()
    {
        File.Reload();
        if (TriggerRadius.Value > Radius.Value) TriggerRadius.Value = Radius.Value;
        Refresh(); Plugin.Log.LogInfo("[Config] 从磁盘重载；" + DodgeSummary());
        return "已从磁盘重载；下一次动作生效。\n" + DodgeSummary();
    }
}
