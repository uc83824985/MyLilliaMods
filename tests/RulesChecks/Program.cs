using LilliaChasePrototype;

int count = 0;
void Check(bool ok, string label) { if (!ok) throw new Exception(label); count++; Console.WriteLine("PASS " + label); }
var d = new DodgeSettings(50, .04f, .3f, 7, .6f, .1f, .08f, .14f);
var c = new CaptureSettings(1.8f, 120, 2, 90, 1.2f, .3f, .15f, 180, .85f, -1, .9f);
Check(Rules.Validate(d, c) == null, "default timings coherent");
Check(Rules.Phase(0, d) == DodgePhase.Startup && Rules.Phase(.04f, d) == DodgePhase.Dash, "startup ends at exact boundary");
Check(Rules.Phase(d.Startup + d.Dash, d) == DodgePhase.Recovery && Rules.Phase(d.Startup + d.Dash + d.Recovery, d) == DodgePhase.Ready, "recovery cannot be shortened");
Check(!Rules.Window(.079f, d) && Rules.Window(.08f, d) && !Rules.Window(.14f, d), "perfect window start inclusive end exclusive");
Check(Rules.Validate(d with { WindowEnd = d.WindowStart }, c) == null && !Rules.Window(d.WindowStart, d with { WindowEnd = d.WindowStart }),
    "zero-length perfect window is valid and never protects");
Check(Rules.Sector(2, 45, 1.2f, 2, 90, 1.2f), "hit radius angle height boundaries inclusive");
foreach (var sample in new[] { (2.001f, 0f, 0f), (1f, 45.001f, 0f), (1f, 180f, 0f), (1f, 0f, 1.201f), (float.NaN, 0f, 0f) })
    Check(!Rules.Sector(sample.Item1, sample.Item2, sample.Item3, 2, 90, 1.2f), "reject outside or invalid " + sample);
Check(Rules.Validate(d with { WindowStart = .01f }, c) != null, "window cannot precede dash");
Check(Rules.Validate(d with { WindowEnd = .4f }, c) != null, "window cannot extend into recovery");
Check(Rules.Validate(d, c with { CommitAt = c.Windup }) != null, "commit must precede resolve");
Check(Rules.Validate(d, c with { TriggerRadius = 3 }) != null, "start range cannot exceed hit range");
Console.WriteLine($"ALL {count} RULE CHECKS PASSED");
