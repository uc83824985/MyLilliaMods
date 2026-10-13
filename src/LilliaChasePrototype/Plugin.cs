using BepInEx;
using BepInEx.Logging;
using BepInEx.Unity.IL2CPP;
using HarmonyLib;
using Il2CppInterop.Runtime.Injection;
using UnityEngine;

namespace LilliaChasePrototype;

[BepInPlugin(Guid, "Lillia Chase Prototype", "0.1.3")]
public sealed class Plugin : BasePlugin
{
    public const string Guid = "local.lillia.chaseprototype";
    internal new static ManualLogSource Log = null!;
    internal static Settings Options = null!;
    internal static Engine Engine = null!;
    private Harmony? harmony;
    private RuntimeHost? host;

    public override void Load()
    {
        Log = base.Log;
        Options = new Settings(Config);
        Engine = new Engine();
        harmony = new Harmony(Guid);
        try
        {
            Engine.Install(harmony);
            ClassInjector.RegisterTypeInIl2Cpp<RuntimeHost>();
            host = AddComponent<RuntimeHost>();
            RuntimeHost.Live = host;
            Log.LogInfo("[Boot] v0.1.3 已加载；Space 闪避，F6 参数，F7 扇形调试。独立配置，不依赖 LilliaSystem。");
        }
        catch (Exception ex)
        {
            Engine.Reset("install-failed"); harmony.UnpatchSelf();
            Engine.CaptureHooksReady = false; Engine.DodgeHooksReady = false;
            Log.LogError("[Boot] 安装失败，已恢复原生逻辑：" + ex);
        }
    }
    public override bool Unload()
    {
        Engine.Reset("unload");
        host?.ClosePanel();
        Panel.Dispose(); RuntimeHost.Live = null;
        if (host != null) UnityEngine.Object.Destroy(host);
        harmony?.UnpatchSelf();
        return true;
    }
}

public sealed class RuntimeHost : MonoBehaviour
{
    public RuntimeHost(IntPtr pointer) : base(pointer) { }
    internal static bool PanelOpen;
    internal static RuntimeHost? Live;
    private bool cursorSaved;
    private bool cursorVisible;
    private CursorLockMode cursorLock;
    private bool wasPlayerLocked, lockSaved;

    public void Update()
    {
        try
        {
            if (Application.isFocused && !KeyBindings.capturing)
            {
                if (Input.GetKeyDown(Plugin.Options.PanelKey.Value)) TogglePanel();
                if (!PanelOpen && Plugin.Options.DebugKey.Value != KeyCode.None && Input.GetKeyDown(Plugin.Options.DebugKey.Value))
                {
                    Plugin.Options.Debug.Value = !Plugin.Options.Debug.Value;
                    Plugin.Options.Refresh();
                }
            }
            if (PanelOpen) { Cursor.lockState = CursorLockMode.None; Cursor.visible = true; KeyBindings.playerLocked = true; }
            Plugin.Engine.Tick();
            try { Panel.Tick(PanelOpen); } catch (Exception ex) { Panel.ReportError(ex); }
        }
        catch (Exception ex)
        {
            Plugin.Engine.Reset("runtime-error");
            Plugin.Engine.CaptureHooksReady = false; Plugin.Engine.DodgeHooksReady = false;
            Plugin.Log.LogError("[Runtime] 模块停用并恢复原生抓捕；请查看异常并重启：" + ex);
        }
    }
    public void LateUpdate()
    {
        try { Plugin.Engine.LateTick(); }
        catch (Exception ex) { Plugin.Log.LogError("[Visual] " + ex); }
    }
    internal void TogglePanel()
    {
        if (PanelOpen) { ClosePanel(); return; }
        cursorVisible = Cursor.visible; cursorLock = Cursor.lockState; cursorSaved = true;
        wasPlayerLocked = KeyBindings.playerLocked; lockSaved = true; KeyBindings.playerLocked = true;
        PanelOpen = true; Plugin.Options.Refresh();
    }
    internal void ClosePanel()
    {
        PanelOpen = false;
        if (lockSaved)
        {
            if (Plugin.Engine.Director?.IsSystemMenuOpen != true && Plugin.Engine.World?.punishmentFlag != true)
                KeyBindings.playerLocked = wasPlayerLocked;
            lockSaved = false;
        }
        if (cursorSaved) { Cursor.visible = cursorVisible; Cursor.lockState = cursorLock; cursorSaved = false; }
    }
    public void OnDestroy() { ClosePanel(); }
}
