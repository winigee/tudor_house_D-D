// Every tunable number in the game lives here (spec section 1, 17).
// No other source file may hard-code a gameplay constant.

export const tuning = {
  sim: {
    /** Fixed simulation rate, Hz. */
    tickHz: 30,
  },

  render: {
    internalWidth: 256,
    internalHeight: 192,
    /** World band height in internal pixels (upper two thirds; trimmed
     * from the spec's 70% to give the text bands breathing room). */
    worldHeight: 120,
    /** Horizontal field of view, degrees. */
    fovDegrees: 90,
    /** Vertical focal length in pixels. Smaller than the horizontal
     * focal (128) so the wall you face square-on keeps its top and
     * bottom edges inside the band — the original's squat anamorphic
     * corridor look. */
    verticalFocal: 96,
    /** Move / turn visual transition, milliseconds. */
    transitionMs: 180,
    /** Near clip plane distance, world units. */
    nearClip: 0.1,
    /** Number of discrete line intensity levels. */
    intensityLevels: 4,
    /** Dash patterns per intensity level, brightest first. */
    dashPatterns: [[], [4, 1], [2, 2], [1, 2]] as number[][],
    /** Default phosphor palette. */
    palettes: {
      white: { fg: '#e8e8e8', bg: '#000000' },
      amber: { fg: '#e8b830', bg: '#000000' },
      green: { fg: '#33ff33', bg: '#000000' },
    },
    defaultPalette: 'white' as 'white' | 'amber' | 'green',
    /** Cursor blink period, milliseconds. */
    cursorBlinkMs: 530,
    /** Wall height as a fraction of cell size. */
    wallHeight: 1.0,
    /** Camera eye height, world units. */
    eyeHeight: 0.5,
    /** Eye sits this far behind the cell centre, along the facing, so
     * the wall ahead projects inside the frame (the nested-rectangle
     * tunnel of the original). */
    cameraBackOff: 0.38,
    /** Doorway opening: half-width and height, world units. */
    doorHalfWidth: 0.22,
    doorHeight: 0.72,
    /** Billboard size of a creature at 1 cell distance, world units. */
    creatureSize: 0.62,
    /** Floor item icon size, world units. */
    itemIconSize: 0.28,
  },

  pulse: {
    /** Resting pulse, beats per minute. */
    resting: 55,
    /** Pulse at or above this kills the player. */
    ceiling: 200,
    /** Commands fail intermittently at or above this. */
    faintThreshold: 180,
    /** Exertion units decayed per tick. */
    exertionDecayPerTick: 0.4,
    /** Beats per minute added per exertion unit. */
    conversionPerUnit: 1.8,
    /** Carried weight at which the conversion factor doubles. */
    weightReference: 60,
    /** Fraction of (target - pulse) applied per tick. */
    approachFactor: 0.035,
    /** Exertion added per point of unblocked creature damage. */
    hitExertionFactor: 1.2,
    /** Probability of command failure exactly at the faint threshold. */
    faintFailFloor: 0.25,
    /** Probability of command failure just below the ceiling. */
    faintFailCeil: 0.85,
  },

  commands: {
    /** Tick costs per verb (weapon swings use the weapon's own cost). */
    costs: {
      MOVE: 12,
      BACK: 15,
      TURN_LEFT: 6,
      TURN_RIGHT: 6,
      TURN_AROUND: 10,
      GET: 10,
      DROP: 8,
      PULL: 12,
      STOW: 12,
      LOOK: 4,
      EXAMINE: 4,
      REVEAL: 20,
      INCANT: 25,
      CLIMB: 40,
      ZSAVE: 0,
      ZLOAD: 0,
      /** Swinging with no weapon in the hand. */
      ATTACK_EMPTY: 4,
    },
    /** Exertion units added per verb. Movement must outpace decay
     * (decay 0.4/tick x MOVE cost 12 = 4.8 break-even) or sprinting
     * could never raise the pulse. */
    exertion: {
      MOVE: 7,
      BACK: 8,
      TURN: 1.5,
      ATTACK: 7,
      GET: 2,
      DROP: 1,
      PULL: 2,
      STOW: 2,
      LOOK: 0.5,
      EXAMINE: 0.5,
      REVEAL: 3,
      INCANT: 6,
      CLIMB: 14,
      BUMP: 2,
    },
  },

  creatures: {
    /** Health fraction below which low-aggression creatures flee. */
    fleeHealthFraction: 0.35,
    /** Probability per idle move window that a creature wanders. */
    idleWanderChance: 0.35,
    /** Ticks the INCANT fear effect lasts. */
    fearTicks: 450,
  },

  light: {
    /** Radius added by the INCANT light effect, cells. */
    incantRadiusBonus: 3,
    /** Ticks the INCANT light effect lasts. */
    incantLightTicks: 600,
  },

  incant: {
    /** Beats per minute removed by the calm word. */
    calmAmount: 40,
  },

  audio: {
    /** Master gain 0..1. */
    masterGain: 0.5,
    /** Distance attenuation floor so far creatures stay faintly audible. */
    attenuationFloor: 0.04,
    /** Heartbeat scheduler lookahead, seconds. */
    heartbeatLookahead: 0.35,
    /** Cells at which a footstep is at full volume. */
    footstepReferenceDistance: 1,
  },

  save: {
    schemaVersion: 1,
    storagePrefix: 'caraross.v1.slot.',
  },

  debug: {
    /** Debug map overlay: pixels per cell. */
    mapCellPx: 3,
  },
} as const;

export type Tuning = typeof tuning;
