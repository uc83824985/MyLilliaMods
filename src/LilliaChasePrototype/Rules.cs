namespace LilliaChasePrototype;

// No Unity dependencies: the runtime and boundary tests use the same rules.
public enum DodgePhase { Ready, Startup, Dash, Recovery }
public enum CapturePhase { Windup, Committed, Recovery }

public readonly record struct DodgeSettings(float Cost, float Startup, float Dash, float Speed,
    float Recovery, float RecoveryScale, float WindowStart, float WindowEnd);
public readonly record struct CaptureSettings(float TriggerRadius, float TriggerAngle, float Radius,
    float Angle, float Height, float Windup, float CommitAt, float TurnSpeed, float Recovery,
    int ObstacleMask, float ProbeHeight);

public static class Rules
{
    public static DodgePhase Phase(float elapsed, DodgeSettings s) => elapsed < s.Startup ? DodgePhase.Startup :
        elapsed < s.Startup + s.Dash ? DodgePhase.Dash :
        elapsed < s.Startup + s.Dash + s.Recovery ? DodgePhase.Recovery : DodgePhase.Ready;

    public static bool Window(float elapsed, DodgeSettings s) => elapsed >= s.WindowStart && elapsed < s.WindowEnd;

    public static bool Sector(float distance, float angleDegrees, float height, float radius, float fullAngle, float maxHeight)
        => float.IsFinite(distance) && float.IsFinite(angleDegrees) && float.IsFinite(height) &&
           distance >= 0 && distance <= radius && Math.Abs(angleDegrees) <= fullAngle * .5f && Math.Abs(height) <= maxHeight;

    public static string? Validate(DodgeSettings d, CaptureSettings c)
    {
        if (d.WindowStart < d.Startup || d.WindowEnd > d.Startup + d.Dash || d.WindowEnd < d.WindowStart)
            return "完美窗口必须位于突进阶段内，结束时间必须大于开始时间。";
        if (c.CommitAt < 0 || c.CommitAt >= c.Windup) return "承诺起点必须早于前摇结束。";
        if (c.TriggerRadius > c.Radius) return "启动半径不能大于命中半径。";
        return null;
    }
}
