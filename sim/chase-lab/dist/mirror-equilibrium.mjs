// Training-only finite-policy candidates; independent audit is not used for fitting.
export const MIRROR_EQUILIBRIUM = {
  "low": {
    "player": {
      "balanced": 0.0014627970078201558,
      "safe_leave": 0.0050313103541330985,
      "safe_return": 0.0010221760328815075,
      "safe_feint": 0.015443979610594839,
      "run_first": 0.009613698278683018,
      "gamble_return": 0.0006045432108295056,
      "cancel_read": 0.005857412391246484,
      "bypass": 0.0006525889545226003,
      "probe_feint": 0.9488537839480781,
      "probe_leave": 0.005138652947174438,
      "probe_run": 0.0004616448728947251,
      "probe_commit": 0.005857412391246484
    },
    "police": {
      "balanced": 0.000589061376918875,
      "pressure_follow": 0.0002433213706589205,
      "pressure_intercept": 0.0009706293618144973,
      "cut_follow": 0.0005094696144987999,
      "cut_intercept": 0.9939851785171218,
      "feint_guard": 0.0002770001548458365,
      "fake_follow": 0.0003596903906274391,
      "guard": 0.0002174485289283996,
      "probe_fast": 0.0015110667628733506,
      "probe_mix": 0.0006562124744430184,
      "probe_cut_guard": 0.00031947327717171215,
      "probe_short_guard": 0.0003614481711006846
    }
  },
  "high": {
    "player": {
      "balanced": 0.002815495819829558,
      "safe_leave": 0.0031027528305821984,
      "safe_return": 0.004398185475766193,
      "safe_feint": 0.5931960327946265,
      "run_first": 0.24456531317263497,
      "gamble_return": 0.003211498096820465,
      "cancel_read": 0.018013937595240594,
      "bypass": 0.1038683473176443,
      "probe_feint": 0.004598922580668213,
      "probe_leave": 0.0034460109944898895,
      "probe_run": 0.0007695657264590801,
      "probe_commit": 0.018013937595240594
    },
    "police": {
      "balanced": 0.0031640026535718958,
      "pressure_follow": 0.0023704991157388073,
      "pressure_intercept": 0.0025032547346952225,
      "cut_follow": 0.9755507545679651,
      "cut_intercept": 0.0013583865172987503,
      "feint_guard": 0.001508069594310888,
      "fake_follow": 0.003314424108078545,
      "guard": 0.0013611809512594855,
      "probe_fast": 0.002847424060365097,
      "probe_mix": 0.0027602871075826318,
      "probe_cut_guard": 0.0017699866370127634,
      "probe_short_guard": 0.0014917299519739996
    }
  }
};
