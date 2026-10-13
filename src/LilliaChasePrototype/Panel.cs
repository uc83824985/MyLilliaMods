using Il2CppInterop.Runtime;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace LilliaChasePrototype;

// Independent Canvas: no System UI dependency and no reliance on IL2CPP OnGUI messages.
internal static class Panel
{
    private static GameObject? canvasObject, window, fieldRoot, ownedEventSystem;
    private static Font? font;
    private static Text? statusLabel, debugLabel, titleLabel;
    private static string group = "General", status = "开发版：调整后点击应用；F7 显示真实判定范围。";
    private static readonly Dictionary<Setting, InputField> fields = new();
    private static readonly Dictionary<Setting, Text> boolLabels = new();
    private static readonly Dictionary<long, Text> captureLabels = new();
    private static bool wasOpen, failed;
    private static readonly Color Background = new(.055f, .07f, .1f, .98f), Ink = new(.9f, .93f, 1f);
    internal static GameObject? CanvasObject => canvasObject;

    internal static void Tick(bool open)
    {
        if (failed) return;
        if (canvasObject == null && (open || Plugin.Options.Debug.Value)) Build();
        if (canvasObject == null || window == null) return;
        canvasObject.SetActive(open || Plugin.Options.Debug.Value); window.SetActive(open);
        if (open && !wasOpen) Refresh(); wasOpen = open;
        if (titleLabel != null) titleLabel.text = "Lillia Chase Prototype / 独立开发调参 [" + Plugin.Options.PanelKey.Value + "]";
        if (statusLabel != null) statusLabel.text = status + "\n" + Plugin.Engine.LastStatus;
        if (open) EnsureEventSystem();
        if (debugLabel != null)
        {
            debugLabel.gameObject.SetActive(Plugin.Options.Debug.Value);
            debugLabel.text = $"Chase Debug | dodge #{Plugin.Engine.DodgeNumber} {Plugin.Engine.DodgePhase} t={Plugin.Engine.DodgeElapsed:F3} protection-used={Plugin.Engine.ProtectionUsed}";
        }
        foreach (var label in captureLabels.Values) if (label != null) label.gameObject.SetActive(false);
        if (Plugin.Options.Debug.Value)
        {
            var camera = Camera.main;
            if (camera != null)
                foreach (var action in Plugin.Engine.Captures.Values)
                {
                    if (action.Police.Owner == null) continue;
                    var p = camera.WorldToViewportPoint(action.Police.Owner.transform.position + Vector3.up * 2.1f);
                    if (p.z <= 0) continue;
                    long id = action.Police.Id;
                    if (!captureLabels.TryGetValue(id, out var label) || label == null)
                    {
                        label = Label(RectObject("CaptureStatus", canvasObject, Vector2.zero, new Vector2(300, 26)), "", 15);
                        captureLabels[id] = label;
                    }
                    label.gameObject.SetActive(true);
                    var rect = label.GetComponent<RectTransform>(); rect.anchorMin = rect.anchorMax = new Vector2(p.x, p.y);
                    rect.pivot = new Vector2(.5f, .5f); rect.anchoredPosition = Vector2.zero;
                    float remaining = action.Phase == CapturePhase.Recovery ? action.Settings.Recovery - action.RecoveryElapsed : action.Settings.Windup - action.Elapsed;
                    label.text = $"#{action.Number} {action.Phase} {remaining:F2}s";
                }
        }
        foreach (long id in captureLabels.Keys.Where(id => !Plugin.Engine.Captures.ContainsKey(id)).ToArray())
        { if (captureLabels[id] != null) UnityEngine.Object.Destroy(captureLabels[id].gameObject); captureLabels.Remove(id); }
    }
    private static void Build()
    {
        font = Font.CreateDynamicFontFromOSFont(new[] { "Microsoft YaHei", "SimHei", "Arial" }, 16);
        if (font == null) throw new InvalidOperationException("Cannot load UI font");
        canvasObject = new GameObject("ChasePrototype_Canvas", Il2CppType.Of<RectTransform>());
        UnityEngine.Object.DontDestroyOnLoad(canvasObject);
        var canvas = canvasObject.AddComponent<Canvas>(); canvas.renderMode = RenderMode.ScreenSpaceOverlay; canvas.sortingOrder = 32760;
        var scaler = canvasObject.AddComponent<CanvasScaler>(); scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1280, 900); scaler.matchWidthOrHeight = .5f;
        canvasObject.AddComponent<GraphicRaycaster>();
        window = RectObject("Parameters", canvasObject, new Vector2(16, -16), new Vector2(820, 790));
        window.AddComponent<Image>().color = Background;
        titleLabel = Label(RectObject("Title", window, new Vector2(18, -12), new Vector2(760, 30)), "Lillia Chase Prototype / 独立开发调参", 21);
        statusLabel = Label(RectObject("Status", window, new Vector2(18, -48), new Vector2(780, 52)), status, 15);
        string[] groups = Plugin.Options.Rows.Select(r => r.Group).Distinct().ToArray();
        for (int i = 0; i < groups.Length; i++)
        {
            string selected = groups[i];
            Button(RectObject("Tab_" + selected, window, new Vector2(16 + i * 99, -108), new Vector2(95, 32)), selected,
                () => { CommitFields(); group = selected; BuildFields(); });
        }
        fieldRoot = RectObject("Fields", window, new Vector2(18, -155), new Vector2(784, 545));
        Button(RectObject("Apply", window, new Vector2(18, -732), new Vector2(170, 38)), "应用并保存", () => { CommitFields(); status = Plugin.Options.Apply(); Refresh(); });
        Button(RectObject("Defaults", window, new Vector2(204, -732), new Vector2(170, 38)), "恢复默认值", () => { status = Plugin.Options.Apply(true); Refresh(); });
        Button(RectObject("Reload", window, new Vector2(390, -732), new Vector2(205, 38)), "从配置文件重载", () => { status = Plugin.Options.Reload(); Refresh(); });
        Button(RectObject("Close", window, new Vector2(612, -732), new Vector2(170, 38)), "关闭面板", () => RuntimeHost.Live?.ClosePanel());
        var debugObject = RectObject("DebugSummary", canvasObject, new Vector2(12, 12), new Vector2(1200, 28));
        var debugRect = debugObject.GetComponent<RectTransform>(); debugRect.anchorMin = debugRect.anchorMax = Vector2.zero; debugRect.pivot = Vector2.zero;
        debugLabel = Label(debugObject, "", 15);
        BuildFields(); Plugin.Log.LogInfo("[Panel] 独立 Canvas 参数面板创建成功");
    }
    private static void BuildFields()
    {
        if (fieldRoot == null) return;
        fields.Clear(); boolLabels.Clear();
        for (int i = fieldRoot.transform.childCount - 1; i >= 0; i--) UnityEngine.Object.Destroy(fieldRoot.transform.GetChild(i).gameObject);
        int index = 0;
        foreach (var row in Plugin.Options.Rows.Where(r => r.Group == group))
        {
            float y = -index++ * 39;
            Label(RectObject("Label_" + row.Entry.Definition.Key, fieldRoot, new Vector2(0, y), new Vector2(525, 34)), row.Label, 16);
            var cell = RectObject("Value_" + row.Entry.Definition.Key, fieldRoot, new Vector2(535, y), new Vector2(242, 34));
            if (row.Entry.SettingType == typeof(bool))
            {
                var b = Button(cell, "", () => { row.Text = (!(bool.TryParse(row.Text, out bool value) && value)).ToString(); RefreshBoolean(row); });
                boolLabels[row] = b.GetComponentInChildren<Text>(); RefreshBoolean(row);
            }
            else
            {
                var background = cell.AddComponent<Image>(); background.color = new Color(.14f, .17f, .23f);
                var textObject = RectObject("Text", cell, new Vector2(6, -2), new Vector2(230, 30));
                var text = Label(textObject, "", 16); text.horizontalOverflow = HorizontalWrapMode.Overflow;
                var field = cell.AddComponent<InputField>(); field.textComponent = text; field.targetGraphic = background;
                field.characterLimit = 128; field.text = row.Text;
                field.onValueChanged.AddListener((Action<string>)(value => row.Text = value)); fields[row] = field;
                field.onEndEdit.AddListener((Action<string>)(value => row.Text = value));
            }
        }
    }
    private static void RefreshBoolean(Setting row)
    { if (boolLabels.TryGetValue(row, out var label) && label != null) label.text = bool.TryParse(row.Text, out bool b) && b ? "开启" : "关闭"; }
    private static void CommitFields()
    {
        // Read native widget values at the transaction boundary as well as through events.
        // This also covers a focused field whose final edit callback has not run yet.
        foreach (var pair in fields) if (pair.Value != null) pair.Key.Text = pair.Value.text;
    }
    private static void Refresh()
    {
        foreach (var pair in fields) if (pair.Value != null) pair.Value.SetTextWithoutNotify(pair.Key.Text);
        foreach (var row in boolLabels.Keys) RefreshBoolean(row);
    }
    private static GameObject RectObject(string name, GameObject parent, Vector2 position, Vector2 size)
    {
        var obj = new GameObject(name, Il2CppType.Of<RectTransform>()); obj.transform.SetParent(parent.transform, false);
        var rect = obj.GetComponent<RectTransform>(); rect.anchorMin = rect.anchorMax = new Vector2(0, 1);
        rect.pivot = new Vector2(0, 1); rect.anchoredPosition = position; rect.sizeDelta = size; return obj;
    }
    private static Text Label(GameObject obj, string value, int size)
    {
        var text = obj.AddComponent<Text>(); text.font = font; text.fontSize = size; text.color = Ink;
        text.text = value; text.alignment = TextAnchor.MiddleLeft; text.raycastTarget = false;
        text.horizontalOverflow = HorizontalWrapMode.Wrap; text.verticalOverflow = VerticalWrapMode.Overflow;
        text.supportRichText = false; return text;
    }
    private static Button Button(GameObject obj, string title, Action click)
    {
        var image = obj.AddComponent<Image>(); image.color = new Color(.19f, .25f, .34f);
        var button = obj.AddComponent<Button>(); button.targetGraphic = image;
        var label = Label(RectObject("Title", obj, Vector2.zero, obj.GetComponent<RectTransform>().sizeDelta), title, 15);
        label.alignment = TextAnchor.MiddleCenter;
        button.onClick.AddListener((Action)(() => { try { click(); } catch (Exception ex) { status = "操作失败，参见日志。"; Plugin.Log.LogError("[Panel] " + ex); } }));
        return button;
    }
    private static void EnsureEventSystem()
    {
        if (EventSystem.current != null || UnityEngine.Object.FindObjectOfType<EventSystem>() != null) return;
        ownedEventSystem = new GameObject("ChasePrototype_EventSystem", Il2CppType.Of<EventSystem>(), Il2CppType.Of<StandaloneInputModule>());
        UnityEngine.Object.DontDestroyOnLoad(ownedEventSystem);
    }
    internal static void Dispose()
    {
        if (canvasObject != null) UnityEngine.Object.Destroy(canvasObject);
        if (ownedEventSystem != null) UnityEngine.Object.Destroy(ownedEventSystem);
        if (font != null) UnityEngine.Object.Destroy(font);
        canvasObject = window = fieldRoot = ownedEventSystem = null; font = null;
        fields.Clear(); boolLabels.Clear(); captureLabels.Clear(); failed = false; wasOpen = false;
    }
    internal static void ReportError(Exception ex)
    { if (!failed) { Plugin.Log.LogError("[Panel] 面板创建失败；配置文件仍可调参：" + ex); Dispose(); failed = true; } }
}
