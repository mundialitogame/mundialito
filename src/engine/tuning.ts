/**
 * Every gameplay-feel constant lives here so the dev panel (?dev=1) can edit
 * them live. Distances are pitch units (pitch is 64 x 96), speeds u/s.
 */
export const PITCH = {
  W: 64,
  H: 96,
  goalHalf: 9.2, // goal mouth half-width
  postR: 0.7,
  gkY: 2.6, // GK standing depth from own goal line
  boxW: 36, // keeper shading range (visual box width)
  boxD: 13
};

export const TUNE = {
  // physics
  dt: 1 / 120,
  ballR: 1.15,
  discR: 2.15,
  fricC0: 5.5, // constant rolling resistance (u/s^2)
  fricC1: 1.05, // viscous damping (1/s)
  restDisc: 0.52, // ball-disc bounce
  restPost: 0.78,
  stopSpeed: 1.1, // below this the ball is at rest
  maxFlight: 9, // seconds, hard cap

  // kicking
  kickMin: 16, // speed at minimum drag
  kickMax: 64, // added speed at full drag
  kickStatBoost: 0.2, // * sho -> extra top speed
  coneBase: 1.6, // degrees, best players
  coneStat: 0.24, // * (99-stat) degrees
  conePower: 1.3, // multiplier at full power (scales up)
  conePressure: 6, // max degrees added under full pressure
  powerNoise: 0.05, // fraction of speed
  ownGoalGuard: 0.25, // power cap multiplier for kicks aimed into own goal mouth

  // pressure
  pressR: 7.2, // base radius
  pressRStat: 0.032, // * def
  pressPowerCap: 0.22, // max power reduction under full pressure

  // charge-down tackle (defender adjacent to the kicker at the moment of the kick)
  tackleR: 6.0,
  tackleBase: 0.15,
  tackleDef: 0.0042, // * def
  tackleCtl: 0.0024, // - * kicker ctl

  // lunge tackle: in TACKLE mode a drag becomes a short aggressive dash in
  // that direction (longer for better defenders). Reach the ball cleanly and
  // you'll usually win it; cross the man before the ball and it's a foul.
  lungeLen: 3.2, // base dash length
  lungeLenStat: 0.045, // + * def
  lungeWin: 0.34,
  lungeWinStat: 0.0052, // * def (gk * 1.12 for rushing keepers)
  lungeCtl: 0.002, // - * carrier ctl
  foulThrough: 0.85, // foul chance when the dash goes through the man first
  tackleHop: 3.5, // a clean winner hops on in the dash direction
  freeKickSpace: 7.5, // opponents are pushed back this far from a free kick
  kickoffR: 13, // everyone but the taker starts outside the centre circle

  // aerial kicks: the red top of the power band is its own trajectory —
  // low-red is a steep chip that dies near the landing ring, max-red a punt
  airThresh: 0.84, // power fraction where a kick goes airborne
  airMax: 40, // extra distance flown at max red (chips fly ~8)
  airLandSpeed: 10, // ground speed after a chip lands
  airLandSpeedMax: 22, // + at full red
  airSavePen: 0.75, // keeper reach factor against dipping shots
  airOverBar: 0.32, // air fraction above which a goal-bound ball clears the bar
  airScatter: 0.06, // landing-spot noise on lofted balls
  bounceRun: 13, // distance the ball stays awkwardly bouncy after touchdown
  bounceTrap: 0.22, // first-touch penalty on a bouncing ball, scaled by ctl

  // interception (soft lunge)
  intR: 1.7, // base radius beyond body
  intRStat: 0.029, // * def
  intBase: 0.7, // top probability scale
  intSpeedRef: 72, // pass speed at which interception collapses
  intSpeedPow: 1.35, // steeper = fast passes much safer
  lungeTime: 0.22, // seconds for lunge tween

  // body contact while attacking: fast balls can squeeze past a defender
  throughSpeed: 0.008, // * (speed - 32)
  throughDef: 0.002, // * (99 - def)
  throughCloseBoost: 0.28, // poking it past a defender right on top of you
  closeZone: 8, // ...applies to blockers this near the kick origin

  // off-ball shoulder challenges (a planned run meets a parked opponent)
  challengeStat: 0.006,

  // receiving
  gatherMax: 50, // a teammate won't try to gather a ball quicker than this — he lets it run
  gatherDeflect: 0.25, // ...but sometimes it clips him anyway
  softTrapSpeed: 22, // a slow ball...
  softTrapSpace: 8, // ...to an unpressured, standing receiver never bobbles
  trapBase: 0.62,
  trapStat: 0.0055, // * ctl
  trapSpeed: 0.0042, // - * ball speed, scaled by (1.55 - ctl/99)
  trapMoving: 0.2, // penalty for receiving on the run, scaled by ctl
  heavyKeep: 0.42, // ball keeps this speed fraction on a heavy touch
  heavyJitter: 24, // degrees
  runSpeed: 8.5, // base u/s for planned runs & loose-ball races
  runSpeedStat: 0.085, // * pac

  // goalkeeping
  saveBase: 1.6, // reach (u) floor
  saveStat: 0.075, // * gk
  saveSpeedPen: 0.044, // reach lost per u/s of shot speed
  catchMargin: 0.55, // fraction of reach inside which a catch is possible
  catchBase: 0.5,
  catchStat: 0.005, // * gk
  parrySafe: 0.55, // good-GK chance the parry goes wide of danger
  gkShade: 0.55, // how far GK shades toward ball angle (0..1)

  // turn structure
  kicksPerHalf: 30, // total kicks (both teams) per half
  aiThinkMs: 550, // cosmetic AI "thinking" delay
  /** planned moves always get at least this long to execute — a feather-touch
      kick doesn't freeze the world, it gifts the defence a free shift */
  minMoveWindow: 1.15,

  // dribbling (a turn spent carrying the ball along a drawn path)
  dribbleSpeed: 0.78, // * the player's run speed
  dribbleMax: 2.3, // seconds of carry per turn
  dribbleChallengeR: 6.0, // defenders this close challenge for the ball
  dispossessBase: 0.42,
  dispossessDef: 0.0045, // * defender def (gk*0.8 for keepers)
  dispossessCtl: 0.0032, // - * carrier (ctl*0.7 + pac*0.3)

  // loose ball
  looseTieBand: 0.13 // within 13% arrival time -> 50/50 weighted by ctl
};

export type Tune = typeof TUNE;
