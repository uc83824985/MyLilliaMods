namespace LilliaChasePrototype;

// No Unity dependencies: the runtime and boundary tests use the same rules.
public enum DodgePhase { Ready, Startup, Dash, Recovery }
public enum CapturePhase { Windup, Committed, Recovery }
public enum CaptureKind { Light, Heavy }

public readonly record struct DodgeSettings(float Cost, float Startup, float Dash, float Speed,
    float Recovery, float RecoveryScale, float WindowStart, float WindowEnd,
    float AnimationSeconds = .55f, bool LinearRecovery = true);
public readonly record struct CaptureSettings(float TriggerRadius, float TriggerAngle, float Radius,
    float Angle, float Height, float Windup, float CommitAt, float TurnSpeed, float Recovery,
    int ObstacleMask, float ProbeHeight, float MoveScale = 0, float Cooldown = .1f, CaptureKind Kind = CaptureKind.Light);

public static class Rules
{
    public static DodgePhase Phase(float elapsed, DodgeSettings s) => elapsed < s.Startup ? DodgePhase.Startup :
        elapsed < s.Startup + s.Dash ? DodgePhase.Dash :
        elapsed < s.Startup + s.Dash + s.Recovery ? DodgePhase.Recovery : DodgePhase.Ready;

    public static bool Window(float elapsed, DodgeSettings s) => elapsed >= s.WindowStart && elapsed < s.WindowEnd;

    public static float RecoveryMoveScale(float elapsed, DodgeSettings s) => s.Recovery <= 0 ? 1 : s.LinearRecovery
        ? s.RecoveryScale + (1 - s.RecoveryScale) * Math.Clamp((elapsed - s.Startup - s.Dash) / s.Recovery, 0, 1)
        : s.RecoveryScale;

    // Choose from the full mixture first; an out-of-range light attack must not turn
    // the outer heavy-only band into a guaranteed heavy attack every frame.
    public static CaptureKind ChooseCapture(float roll, float heavyChance) => roll < heavyChance ? CaptureKind.Heavy : CaptureKind.Light;

    public static bool Sector(float distance, float angleDegrees, float height, float radius, float fullAngle, float maxHeight)
        => float.IsFinite(distance) && float.IsFinite(angleDegrees) && float.IsFinite(height) &&
           distance >= 0 && distance <= radius && Math.Abs(angleDegrees) <= fullAngle * .5f && Math.Abs(height) <= maxHeight;

    public static string? Validate(DodgeSettings d, CaptureSettings c)
    {
        if (d.WindowStart < d.Startup || d.WindowEnd > d.Startup + d.Dash || d.WindowEnd < d.WindowStart)
            return "完美窗口必须位于突进阶段内，结束时间必须大于开始时间。";
        if (c.CommitAt < 0 || c.CommitAt > c.Windup) return "跟踪结束不能晚于前摇结束。";
        return null;
    }
}
