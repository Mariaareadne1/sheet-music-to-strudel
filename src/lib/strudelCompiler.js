/**
 * strudelCompiler.js
 *
 * Pure deterministic function: music JSON → Strudel source code.
 * No approximations, no string guessing. Every decision is arithmetic.
 *
 * Single public export: compileToStrudel(json, patternMap)
 */

// ── Beat duration table (single source of truth) ─────────────────────────────

const BEAT_VALUE = {
  'whole':             4.0,
  'dotted_half':       3.0,
  'half':              2.0,
  'dotted_quarter':    1.5,
  'quarter':           1.0,
  'dotted_eighth':     0.75,
  'eighth':            0.5,
  'dotted_sixteenth':  0.375,
  'sixteenth':         0.25,
  'thirty_second':     0.125,
  'quarter_triplet':   2 / 3,
  'eighth_triplet':    1 / 3,
  'sixteenth_triplet': 1 / 6,
}

// ── Step 1 — pitch string ─────────────────────────────────────────────────────

function pitchToString(note) {
  if (!note.pitch || note.pitch === 'rest') return '~'
  return note.pitch.toLowerCase().replace(/[^a-g#b0-9]/g, '')
}

// ── Step 2 — group notes into beat slots ──────────────────────────────────────

/**
 * Groups a voice's note array into beat-sized slots.
 *
 * Each slot represents a quantum of time that maps to one token in the final
 * measure string.  Slots accumulate events until their beat total crosses a
 * clean boundary (1.0, 1.5, 2.0, 3.0, 4.0…).
 *
 * Special case: two quarter triplets accumulate to 1.333 beats (4/3), which
 * is NOT a clean boundary.  The flush is suppressed so the third triplet can
 * join them, completing the 2-beat group that slotToToken expects.
 */
function groupNotesIntoBeats(notes, beatsPerMeasure) {
  // ── chord grouping: consecutive notes with chord:true attach to the one before
  const events = []
  let i = 0
  while (i < notes.length) {
    const event = { notes: [notes[i]], beats: BEAT_VALUE[notes[i].duration] ?? 1.0 }
    i++
    while (i < notes.length && notes[i].chord === true) {
      event.notes.push(notes[i])
      i++
    }
    events.push(event)
  }

  // ── accumulate into slots
  const slots        = []
  let currentSlot    = []
  let currentBeats   = 0.0

  for (const event of events) {
    currentSlot.push(event)
    currentBeats += event.beats
    currentBeats  = Math.round(currentBeats * 1000) / 1000

    // Suppress flush when we're mid-quarter-triplet group (4/3 ≈ 1.333 beats):
    // the third triplet will bring the total to exactly 2.0.
    const atPartialQTriplet = Math.abs(currentBeats - 4 / 3) < 0.005

    if (currentBeats >= 1.0 && !atPartialQTriplet) {
      slots.push({ events: currentSlot, totalBeats: currentBeats })
      currentSlot  = []
      currentBeats = 0.0
    }
  }

  // flush any remaining events (incomplete last beat)
  if (currentSlot.length > 0) {
    slots.push({ events: currentSlot, totalBeats: currentBeats })
  }

  return slots
}

// ── Step 3 — single event → token string ─────────────────────────────────────

function eventToToken(event) {
  if (event.notes.length === 1) {
    return pitchToString(event.notes[0])
  }
  // Chord: comma-separated pitches inside brackets
  return '[' + event.notes.map(n => pitchToString(n)).join(',') + ']'
}

// ── Step 4 — beat slot → Strudel token ───────────────────────────────────────

function slotToToken(slot) {
  const { events, totalBeats } = slot

  // ── Case 1: single event spanning one or more beats
  if (events.length === 1 && totalBeats >= 1.0) {
    const token = eventToToken(events[0])
    if (totalBeats === 1.0) return token
    if (totalBeats === 1.5) return token + '@1.5'
    if (totalBeats === 2.0) return token + '@2'
    if (totalBeats === 3.0) return token + '@3'
    if (totalBeats === 4.0) return token + '@4'
    // Non-standard long duration — use exact numeric modifier
    return token + '@' + totalBeats
  }

  // ── Case 2: multiple events sharing a beat slot
  const tokens = events.map(e => eventToToken(e))

  // Two eighth notes → [a b]
  if (events.length === 2 &&
      events.every(e => Math.abs(e.beats - 0.5) < 0.005)) {
    return '[' + tokens.join(' ') + ']'
  }

  // Three eighth-note triplets (1 beat) → [a b c]
  if (events.length === 3 &&
      events.every(e => Math.abs(e.beats - 1 / 3) < 0.005)) {
    return '[' + tokens.join(' ') + ']'
  }

  // Three quarter-note triplets (2 beats) → [a b c]@2
  if (events.length === 3 &&
      events.every(e => Math.abs(e.beats - 2 / 3) < 0.005)) {
    return '[' + tokens.join(' ') + ']@2'
  }

  // Four sixteenth notes (1 beat) → [[a b c d]]
  if (events.length === 4 &&
      events.every(e => Math.abs(e.beats - 0.25) < 0.005)) {
    return '[[' + tokens.join(' ') + ']]'
  }

  // Eight 32nd notes (1 beat) → [[[a b c d e f g h]]]
  if (events.length === 8 &&
      events.every(e => Math.abs(e.beats - 0.125) < 0.005)) {
    return '[[[' + tokens.join(' ') + ']]]'
  }

  // Dotted-eighth + sixteenth (0.75 + 0.25 = 1 beat) → [a@3 b]
  if (events.length === 2 &&
      Math.abs(events[0].beats - 0.75) < 0.005 &&
      Math.abs(events[1].beats - 0.25) < 0.005) {
    return '[' + tokens[0] + '@3 ' + tokens[1] + ']'
  }

  // Fallback: assign integer @-weights relative to the shortest event in the slot
  const minBeat = Math.min(...events.map(e => e.beats))
  const weighted = events.map(e => {
    const w = Math.round(e.beats / minBeat)
    return w === 1 ? eventToToken(e) : eventToToken(e) + '@' + w
  })
  return '[' + weighted.join(' ') + ']'
}

// ── Step 5 — one measure → per-voice token strings ───────────────────────────

const VOICE_NAMES = ['treble', 'bass', 'staff2', 'staff3', 'staff4']

function measureToPatternString(measure, beatsPerMeasure) {
  const result = {}
  for (const voice of VOICE_NAMES) {
    if (!measure[voice] || measure[voice].length === 0) continue
    const slots  = groupNotesIntoBeats(measure[voice], beatsPerMeasure)
    const tokens = slots.map(s => slotToToken(s))
    result[voice] = tokens.join(' ')
  }
  return result
}

// ── STRUDEL_CONDENSING_RULES — complete notation equivalence reference ─────────
//
// This constant is the knowledge base driving condenseMeasure and
// mergeArrangeEntries.  Every group of examples produces identical output;
// the LAST option in each group is the most concise form.

const STRUDEL_CONDENSING_RULES = `
============================================================
STRUDEL NOTATION EQUIVALENTS — COMPLETE REFERENCE
Every group below produces IDENTICAL output.
The LAST option in each group is the MOST CONCISE.
============================================================

── SECTION 1: SEQUENCE REPETITION ──────────────────────────

// Repeating a single note N times:
note("c4 c4 c4 c4")           // verbose
note("c4!4")                   // CONCISE — ! means replicate

note("c4 c4 c4")               // verbose
note("c4!3")                   // CONCISE

note("bd bd")                  // verbose
note("bd!2")                   // CONCISE

// Repeating a group N times:
note("c4 e4 c4 e4 c4 e4")     // verbose
note("[c4 e4]!3")              // CONCISE

sound("bd hh bd hh bd hh bd hh")  // verbose
sound("[bd hh]!4")                 // CONCISE

── SECTION 2: SPEED MULTIPLICATION ─────────────────────────

// Playing a pattern N times per cycle:
sound("bd sd bd sd")           // plays twice per cycle already
sound("bd sd")*2               // CONCISE — same output

sound("hh hh hh hh hh hh hh hh")  // 8 hihats verbose
sound("hh")*8                       // CONCISE
sound("hh*8")                        // ALSO CONCISE — inside mini-notation

sound("bd sd bd sd bd sd bd sd")   // verbose
sound("bd sd")*4                    // CONCISE

// Inside mini-notation * means speed up that element:
sound("bd hh*2 sd hh*2")      // hh plays twice as fast = 2 hits per beat slot
// same as:
sound("bd [hh hh] sd [hh hh]")  // verbose version

── SECTION 3: SLOWING DOWN / ────────────────────────────────

// Playing a pattern over multiple cycles:
note("[c4 e4 g4 b4]")/2       // takes 2 cycles to complete
note("<c4 e4>")               // ALSO takes 2 cycles — alternate syntax

note("[c4 e4 g4 b4 d5 f5]")/3  // takes 3 cycles
note("<c4 e4 g4>")              // same — alternates one per cycle

// The angle bracket shorthand:
note("<a b>")    === note("[a b]/2")    // plays a on cycle 1, b on cycle 2
note("<a b c>")  === note("[a b c]/3")  // one per cycle
note("<a b c d>") === note("[a b c d]/4")

── SECTION 4: PITCH — LETTER VS NUMBER VS SCALE ─────────────

// These all play the same C major scale:
note("c4 d4 e4 f4 g4 a4 b4")                    // explicit letters
note("48 50 52 53 55 57 59")                      // MIDI numbers
n("0 1 2 3 4 5 6").scale("C4:major")             // scale degrees

// D major scale starting on D4:
note("d4 e4 f#4 g4 a4 b4 c#5")
n("0 1 2 3 4 5 6").scale("D4:major")             // CONCISE

// C minor:
note("c4 d4 eb4 f4 g4 ab4 bb4")
n("0 1 2 3 4 5 6").scale("C4:minor")             // CONCISE

// Single note in a scale — transposing:
note("c4").add(7)              // adds 7 semitones = G4
note("g4")                    // same thing, verbose

// Chord by name vs explicit notes:
note("c4 e4 g4")              // C major chord spelled out
note("[c4,e4,g4]")            // chord notation — simultaneous

── SECTION 5: RESTS ─────────────────────────────────────────

// Rest notations — all identical:
note("~")                     // standard rest
note("-")                     // also valid rest in sound() patterns

// Half rest:
note("~@2")                   // rest lasting 2 beats

// Whole rest:
note("~@4")                   // rest lasting 4 beats

// Rest in a sequence:
note("c4 ~ e4 ~")            // notes on beats 1 and 3
note("c4 - e4 -")            // same with dash notation

── SECTION 6: DURATION / ELONGATION ─────────────────────────

// Whole note:
note("c4@4")                  // explicit weight
note("[c4]/1")*0.25           // never do this — use @4

// Half note:
note("c4@2 e4")               // c4 is twice as long as e4

// Dotted quarter (1.5 beats):
note("c4@1.5 d4")

// Two eighth notes = one beat:
note("[c4 d4]")               // sub-sequence — both share one beat slot

// Four sixteenth notes = one beat:
note("[[c4 d4 e4 f4]]")       // double bracket

// Eight 32nd notes = one beat:
note("[[[c4 d4 e4 f4 g4 a4 b4 c5]]]")  // triple bracket

// Triplets:
note("[c4 e4 g4]")            // 3 notes sharing 1 beat = eighth triplet
note("[c4 e4 g4]@2")          // 3 notes sharing 2 beats = quarter triplet

── SECTION 7: PARALLEL / SIMULTANEOUS PATTERNS ──────────────

// These all play two patterns at the same time:
stack(note("c4 e4"), note("g4 b4"))          // explicit stack
note("c4 e4, g4 b4")                          // comma inside string

// Multiple $: patterns:
$: note("c4 e4").sound("piano")
$: note("g4 b4").sound("bass")
// same as:
stack(
  note("c4 e4").sound("piano"),
  note("g4 b4").sound("bass")
)

── SECTION 8: ALTERNATING PATTERNS ──────────────────────────

// Alternate between values each cycle:
note("c4 <e4 g4>")           // beat 1 always c4, beat 2 alternates e4/g4

// Classic drum pattern — verbose vs concise:
sound("bd hh sd hh bd hh sd hh")   // 8 events verbose
sound("bd hh sd hh")*2              // CONCISE — repeat twice

// Alternating kick patterns:
sound("<bd cp> hh")          // alternates bd and cp on beat 1 each cycle

// Alternating whole measures:
note("<[c4 e4 g4] [d4 f4 a4]>")   // measure 1 = C chord, measure 2 = D chord

── SECTION 9: SUB-SEQUENCES ─────────────────────────────────

// Playing 2 notes in the space of 1:
note("[c4 e4] g4")           // [c4 e4] = two eighth notes in one beat

// Equivalent ways to write a beat with subdivision:
sound("bd [hh hh] sd [hh hh]")   // standard
sound("bd hh*2 sd hh*2")          // CONCISE — * inside mini-notation

// Nested subdivision:
sound("bd [[hh oh] hh] sd hh")   // hh and oh share first half of beat 2

── SECTION 10: PARALLEL INSIDE MINI-NOTATION ────────────────

// Comma creates parallel tracks inside one sound() call:
sound("bd hh, cp")           // bd+hh sequence AND cp playing together
sound("hh hh hh hh, bd ~ bd ~")  // hihat pattern + kick pattern layered

// Same as:
stack(sound("bd hh"), sound("cp"))

── SECTION 11: ARRANGEMENT — SECTION REPETITION ─────────────

// Playing a section N times:
arrange(
  [1, sectionA],
  [1, sectionA],
  [1, sectionA],
  [1, sectionB]
)
// CONCISE version:
arrange(
  [3, sectionA],   // 3 means play for 3 cycles
  [1, sectionB]
)

── SECTION 12: STRUCTURE — LONG MELODIES ────────────────────

// A melody that takes 4 cycles to play through:
note("<[c4 e4 g4 b4] [d4 f4 a4 c5] [e4 g4 b4 d5] [f4 a4 c5 e5]>/4")
// same as writing 4 separate patterns and using arrange([1,A],[1,B],[1,C],[1,D])

// Single measure repeated 4 times:
note("<[c4 e4 g4 b4]>/1")   // one measure, plays every cycle
// if used in arrange([4, ...]) it plays 4 cycles

── SECTION 13: DRUM PATTERN EQUIVALENTS ─────────────────────

// Standard 4/4 rock beat — multiple equivalent forms:
sound("bd ~ sd ~ bd ~ sd ~")                    // explicit
sound("bd - sd - bd - sd -")                    // with dashes
sound("[bd ~ sd ~]!2")                           // using replication
sound("bd ~ sd ~")*2                             // using *

// 8th note hihat:
sound("hh hh hh hh hh hh hh hh")               // verbose
sound("hh!8")                                    // CONCISE
sound("hh*8")                                    // ALSO CONCISE
sound("hh")*8                                    // function form

// Classic house beat:
sound("bd*4, ~ cp ~ cp, hh*8")                  // CONCISE layered
// same as:
stack(
  sound("bd*4"),
  sound("~ cp ~ cp"),
  sound("hh*8")
)

── SECTION 14: NOTE FUNCTION EQUIVALENTS ────────────────────

// note() and n() with .sound():
note("c4 e4 g4").sound("piano")
n("0 4 7").scale("C4:major").sound("piano")     // scale degree version

// s() is shorthand for sound():
s("bd sd hh")
sound("bd sd hh")                               // same thing

// note() with number = MIDI:
note("60 64 67")                                // C4 E4 G4 as MIDI
note("c4 e4 g4")                               // same, letter form

── SECTION 15: EFFECT SHORTHANDS ────────────────────────────

// These pairs are identical:
.sound("x")    ===   .s("x")
.delay(0.5).delaytime(0.25).delayfeedback(0.3)
  ===  .delay(0.5).dt(0.25).dfb(0.3)           // shorthand params

// room and size:
.room(0.5)                                      // reverb
.room(0.5).roomsize(2)                          // with room size

============================================================
HOW TO APPLY THESE RULES IN THE COMPILER:

When building a measure string, after computing all tokens, run through
these checks IN ORDER from most impactful to least:

1. Check for N consecutive identical tokens → replace with token!N
2. Check for identical bracket groups repeating → replace with [group]!N
3. Check for a pattern that repeats to fill the measure → use *N
4. Check if all notes are in a known scale → offer n().scale() form
5. Check arrange() entries for consecutive identical refs → merge to [N, ref]
6. Check if all notes are the same → collapse to note!count

NEVER sacrifice correctness for conciseness.
If unsure whether two forms are equivalent, use the explicit form.
============================================================

── SECTION 26: RANDOM CHOICE & WEIGHTED SELECTION ──────────────

// | pipe = equal random choice each cycle:
note("c4 | e4 | g4")           // randomly picks one each cycle
chooseCycles("c4","e4","g4").note()  // same thing, function form
// alias: randcat

// Weighted random — give probabilities:
wchooseCycles(["c4",5],["e4",3],["g4",1]).note()
// c4 plays 5/9 of the time, e4 plays 3/9, g4 plays 1/9

// choose() for continuous random selection:
note("c2 g2 d2").s(choose("sine","triangle","sawtooth"))
// each note gets a randomly chosen instrument

// wchoose() with weights:
note("c2 g2").s(wchoose(["piano",10],["violin",1]))

── SECTION 27: PROBABILITY & DEGRADATION ───────────────────────

// Remove events randomly:
s("hh*8").degradeBy(0.2)       // 20% chance each hh is removed
s("[hh?0.2]*8")                 // same in mini-notation
s("hh*8").degrade()            // 50% removal — same as degradeBy(0.5)
s("[hh?]*8")                    // same in mini-notation

// Inverse — keep only the removed ones:
s("hh*8").undegradeBy(0.2)     // keep the 20% that degrade removed

// Split a pattern into degraded and undegraded halves:
s("hh*10").layer(
  x => x.degradeBy(0.5).pan(0),    // random half goes left
  x => x.undegradeBy(0.5).pan(1)   // other half goes right
)

── SECTION 28: PROBABILITY FUNCTION APPLICATION ────────────────

// Apply a function with a given probability:
s("hh*8").sometimesBy(0.4, x=>x.speed(0.5))  // 40% of the time
s("hh*8").sometimes(x=>x.speed(0.5))           // 50% of the time
s("hh*8").often(x=>x.speed(0.5))               // 75% of the time
s("hh*8").rarely(x=>x.speed(0.5))              // 25% of the time
s("hh*8").almostAlways(x=>x.speed(0.5))        // 90% of the time
s("hh*8").almostNever(x=>x.speed(0.5))         // 10% of the time
s("hh*8").always(x=>x.speed(0.5))              // 100% — same as no condition
s("hh*8").never(x=>x.speed(0.5))               // 0% — does nothing

// Per-cycle probability (whole cycle changes at once):
s("bd,hh*8").someCyclesBy(0.3, x=>x.speed(0.5))
s("bd,hh*8").someCycles(x=>x.speed(0.5))       // 50% of cycles

── SECTION 29: LAYERING & SUPERIMPOSITION ──────────────────────

// superimpose — layer a transformed copy ON TOP of original:
note("c3 eb3 g3").superimpose(x=>x.add(7))
// plays original AND a version transposed up 7 semitones simultaneously

// layer — like superimpose but WITHOUT the original:
note("c3 eb3 g3").layer(x=>x.add("0,7"))
// alias: apply

// off — offset copy layered on top:
note("c3 eb3 g3").off(1/8, x=>x.add(7))
// plays a copy delayed by 1/8 cycle, transposed up 7 semitones
// Great for creating harmonies and countermelodies

// echo — repeated echoes with decreasing volume:
s("bd sd").echo(3, 1/6, 0.8)
// plays 3 times, each 1/6 cycle apart, each 80% volume of previous

// echoWith — echo with custom transform each time:
note("<0 [2 4]>").echoWith(4, 1/8, (p,n) => p.add(n*2))
  .scale("C:minor")
// each echo adds 2 more semitones than the last

── SECTION 30: RHYTHM STRUCTURE TOOLS ──────────────────────────

// struct — apply a rhythmic structure to a pattern:
note("c,eb,g").struct("x ~ x ~ ~ x ~ x ~ ~ ~ x ~ x ~ ~").slow(2)
// the note chord plays only where x appears in the structure

// mask — silence by pattern (1=play, 0=silence):
note("c [eb,g] d [eb,g]").mask("<1 [0 1]>")
// every other cycle, first beat is silenced

// hush — silence a whole pattern:
stack(s("bd").hush(), s("hh*3"))
// useful for muting layers

// arp — arpeggiate stacked chord notes by index pattern:
note("<[c,eb,g]!2 [c,f,ab] [d,f,ab]>").arp("0 [0,2] 1 [0,2]")
// picks individual notes from chords by position

── SECTION 31: CONDITIONAL TRANSFORMATION ──────────────────────

// when — apply function when pattern is truthy:
note("c3 eb3 g3").when("<0 1>/2", x=>x.sub(5))
// every other cycle, transpose down 5 semitones

// firstOf — apply every N cycles, on cycle 1:
note("c3 d3 e3 g3").firstOf(4, x=>x.rev())
// reverses on the first of every 4 cycles

// lastOf — apply every N cycles, on the last cycle:
note("c3 d3 e3 g3").lastOf(4, x=>x.rev())
// reverses on the last of every 4 cycles

// chunk — cycle through subdivisions applying function:
note("0 1 2 3").chunk(4, x=>x.add(7)).scale("A:minor")
// each cycle applies the function to a different quarter of the pattern

// chunkBack — same but in reverse order:
note("0 1 2 3").chunkBack(4, x=>x.add(7)).scale("A:minor")

── SECTION 32: PICK & INHABIT — PATTERN SELECTION ─────────────

// pick — select patterns by index:
note("<0 1 2!2 3>".pick(["g a","e f","f g f g","g c d"]))
sound("<0 1 [2,0]>".pick(["bd sd","cp cp","hh hh"]))

// inhabit — pick patterns but squeeze them into target structure:
let a = s("bd(3,8)")
let b = s("cp sd")
"<a b [a,b]>".inhabit({a, b})
// named pattern selection — very powerful for song structure

// pickRestart — picks AND restarts chosen pattern from beginning:
"<a@2 b@2 c@2 d@2>".pickRestart({
  a: n("0 1 2 0"),
  b: n("2 3 4 ~"),
  c: n("[4 5] [4 3] 2 0"),
  d: n("0 -3 0 ~")
}).scale("C:major").s("piano")

── SECTION 33: SIGNALS — CONTINUOUS MODULATION ─────────────────

// Signals are continuous streams of numbers for effects:
// Range 0 to 1: saw, sine, cosine, tri, square, rand, perlin
// Range -1 to 1: saw2, sine2, cosine2, tri2, square2, rand2

// Use signals for organic, moving effects:
s("hh*16").gain(sine)                    // volume breathes
s("hh*16").pan(sine)                     // pans left/right
note("c4 e4").lpf(saw.range(200,2000))   // filter sweeps up
note("c4 e4").lpf(sine.range(200,2000).slow(4))  // slow filter wobble

// irand — random integers:
n(irand(8)).struct("x x*2 x x*3").scale("C:minor")
// random scale degrees, with rhythmic structure applied

// brand — binary random (0 or 1):
s("hh*10").pan(brand)      // randomly pans each hit left or right
s("hh*10").pan(brandBy(0.2))  // 20% chance of right pan

// Mouse control (live performance):
n(mouseX.segment(4).range(0,7)).scale("C:minor")  // mouse x = pitch
n(mouseY.segment(4).range(0,7)).scale("C:minor")  // mouse y = pitch

── SECTION 34: STEPWISE FUNCTIONS (experimental) ───────────────

// stepcat — concatenate proportionally by step count:
stepcat([3,"e3"],[1,"g3"]).note()   === note("e3@3 g3")
stepcat("bd sd cp","hh hh").sound() === sound("bd sd cp hh hh")
// alias: timecat, timeCat

// pace — set steps per cycle:
sound("bd sd cp").pace(4)
=== sound("{bd sd cp}%4")
=== sound("<bd sd cp>*4")

// polymeter — align steps creating phase shifting:
polymeter("c eb g","c2 g2").note()
=== note("{c eb g, c2 g2}%6")
// patterns repeat until LCM fits — creates rotation over time

// expand / contract — stretch/compress step sizes:
sound("tha dhi thom nam").expand("3 2 1").pace(8)
// steps get longer then shorter each cycle

// extend — increase density AND step count:
stepcat(sound("bd bd - cp").extend(2), sound("bd - sd -")).pace(8)

// take / drop — cut steps from pattern:
note("bd cp ht mt").take("2")  === note("bd cp")  // first 2 steps
note("bd cp ht mt").drop("1")                     // drop first step

// grow / shrink — progressively reveal/hide pattern:
note("c d e f").grow("1").sound("piano").pace(4)
// cycle 1: c, cycle 2: c d, cycle 3: c d e, cycle 4: c d e f

note("c d e f").shrink("1").sound("piano").pace(4)
// opposite — starts full, removes one step each cycle

── SECTION 35: COMPOSITION PATTERNS (how real songs are built) ──

// PATTERN 1 — Theme and variation:
const theme = note("c4 e4 g4 e4").sound("piano")
theme                              // original
theme.superimpose(x=>x.add(7))    // with harmony
theme.rev()                        // reversed
theme.fast(2)                      // double time
theme.lastOf(4, x=>x.rev())        // occasional reverse

// PATTERN 2 — Building tension with degradeBy:
// Start sparse, get denser each section:
s("hh*8").degradeBy(0.8)   // very sparse hihat
s("hh*8").degradeBy(0.4)   // getting denser
s("hh*8").degradeBy(0.0)   // full hihat

// PATTERN 3 — Call and response with firstOf/lastOf:
note("c4 e4 g4 ~").firstOf(2, x=>x.add(5))
// plays c4 e4 g4 ~ then f4 a4 c5 ~ alternating

// PATTERN 4 — Polyrhythm with $: patterns:
$: s("bd*3").slow(2)         // 3 against 4
$: s("sd*4")                 // 4 beats
$: s("hh*5").slow(2)         // 5 against 4

// PATTERN 5 — Chord progression with rootNotes bass:
const chords = chord("<C Am F G>*2")
$: chords.voicing().s("piano").room(0.3)
$: chords.rootNotes(2).note().s("gm_acoustic_bass")

// PATTERN 6 — Melodic sequence over chord changes:
n("0 1 2 3 4 3 2 1")
  .scale("<C:major A:minor F:major G:major>/4")
  .sound("piano")
// scale changes every 4 cycles following chord progression

// PATTERN 7 — Euclidean polyrhythm drum kit:
$: s("bd(3,8), sd(2,8), hh(7,8), cp(1,8,4)").bank("RolandTR909")

// PATTERN 8 — Echo/delay for texture:
note("c3 eb3 g3").off(1/8, x=>x.add(7)).off(1/4, x=>x.add(12))
// three layers: original, harmony 1/8 late, octave 1/4 late

// PATTERN 9 — Chunk for evolving melody:
note("0 1 2 3 4 5 6 7").scale("C:minor")
  .chunk(4, x=>x.add(7))
// each quarter of the scale gets transposed in turn

// PATTERN 10 — Signal-driven generative music:
n(irand(8).segment(8))
  .scale("C:pentatonic")
  .sound("piano")
  .room(perlin.range(0.2, 0.8))
  .gain(sine.range(0.4, 0.9).slow(4))
// random pentatonic notes, organic reverb and volume

── SECTION 36: PERFORMANCE TECHNIQUES ──────────────────────────

// .hush() to mute a layer live
// commenting out $: lines to remove layers
// .mask("<1 0>") to create drops
// .degradeBy(x) sweep from 0 to 1 to thin out
// .room(x) sweep from 0 to 1 for build-up
// .gain(sine.slow(8)) for slow volume breathing
// .lpf(saw.range(200,4000).slow(4)) for filter sweeps
// .fast(2) / .slow(2) for half/double time effects
// .rev() for sudden pattern reversal
// .jux(rev) for stereo widening
// .echo(3,1/8,0.7) for instant depth

================================================================
COMPOSITION ASSISTANCE RULES:
When generating Strudel code for creative/composition purposes
(not just transcription), prefer:

1. Use chord() + voicing() for harmonic content over explicit notes
2. Use n().scale() for melodic lines over explicit note names
3. Use Euclidean rhythms (k,n) for percussion
4. Add .off() or .superimpose() for automatic harmonization
5. Add signals (sine, perlin) to effects for organic movement
6. Use firstOf/lastOf for variation without rewriting patterns
7. Use echo() for instant depth and space
8. Use chunk() to create evolving, self-transforming melodies
9. Use degradeBy patterns for tension/release arcs
10. Use polymeter() for rhythmic interest and phase shifting
================================================================
`

// ── Step 6 — condense repeated tokens within a measure ───────────────────────

// Splits a measure string into top-level tokens, respecting bracket nesting.
function tokenizeMeasure(str) {
  const tokens = []
  let depth = 0
  let current = ''
  for (const ch of str) {
    if (ch === '[') {
      depth++
      current += ch
    } else if (ch === ']') {
      depth--
      current += ch
    } else if (ch === ' ' && depth === 0) {
      if (current) { tokens.push(current); current = '' }
    } else {
      current += ch
    }
  }
  if (current) tokens.push(current)
  return tokens
}

// True when a token's leading word is a percussion sound name (Section 13).
function isPercussionToken(token) {
  const core = token.replace(/[\[\]]/g, '').split(/[\s@!*]/)[0]
  return /^(bd|sd|hh|oh|cp|rim|kick|snare|hat|crash)$/i.test(core)
}

// Compresses a token array following STRUDEL_CONDENSING_RULES priority order:
//
//  Rule 3 (whole-measure fill, bracket group) → token*N   e.g. [c4 e4]*4
//  Rule 5 (whole-measure fill, percussion)    → token*N   e.g. hh*8
//  Rule 3 (whole-measure fill, simple note)   → token!N   e.g. c4!4  (prefer !)
//  Rules 1 & 2 (partial consecutive runs)     → token!N   e.g. c4!3 e4
function applyReplication(tokens) {
  if (tokens.length === 0) return ''
  if (tokens.length === 1) return tokens[0]

  // Whole-measure: every slot is the same token
  if (tokens.every(t => t === tokens[0])) {
    const token = tokens[0]
    const n = tokens.length
    const isBracket = token.startsWith('[')
    const isPerc    = isPercussionToken(token)
    return (isBracket || isPerc) ? `${token}*${n}` : `${token}!${n}`
  }

  // Partial runs: collapse consecutive identical tokens with !N (Rules 1 & 2)
  const result = []
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]
    let count = 1
    while (i + count < tokens.length && tokens[i + count] === token) count++
    result.push(count > 1 ? `${token}!${count}` : token)
    i += count
  }
  return result.join(' ')
}

function condenseMeasure(str) {
  const tokens = tokenizeMeasure(str)
  if (tokens.length <= 1) return str
  return applyReplication(tokens)
}

// ── Step 7 — merge consecutive identical arrange() entries (Rule 4) ───────────
//
// Implements Section 11 of STRUDEL_CONDENSING_RULES:
//   [1,A],[1,A],[1,A],[1,B]  →  [3,A],[1,B]
//   [2,A],[1,A]              →  [3,A]   (counts sum across adjacent identical labels)

function mergeArrangeEntries(labels) {
  if (labels.length === 0) return []
  const merged = []
  let i = 0
  while (i < labels.length) {
    const label = labels[i]
    let count = 1
    while (i + count < labels.length && labels[i + count] === label) count++
    merged.push({ label, count })
    i += count
  }
  return merged
}

// ── Step 8 — built-in syntax checker ─────────────────────────────────────────

function validateOutput(code) {
  const errors = []

  // Invalid @ fractions (must use bracket notation)
  if (/@0\.(5|25|125|375|75)\b/.test(code)) {
    errors.push('Invalid fractional @-modifier found — use bracket notation')
  }

  // Bracket balance (covers all of the code, not just note strings)
  let depth = 0
  for (const ch of code) {
    if (ch === '[') depth++
    if (ch === ']') depth--
    if (depth < 0) { errors.push('Mismatched brackets (extra ])'); break }
  }
  if (depth !== 0) errors.push(`Unclosed brackets: ${depth} unclosed [`)

  // Angle-bracket balance inside each note("...") call
  for (const match of (code.match(/note\("([^"]+)"\)/g) ?? [])) {
    const inner  = match.slice(6, -2)
    const opens  = (inner.match(/</g) ?? []).length
    const closes = (inner.match(/>/g) ?? []).length
    if (opens !== closes) {
      errors.push(`Mismatched <> in: ${match.slice(0, 40)}`)
    }
  }

  if (/>\s*\/\s*0/.test(code))  errors.push('Division by zero in pattern (>/0)')
  if (/note\(""\)/.test(code))  errors.push('Empty note pattern: note("")')

  if (errors.length > 0) {
    console.warn('[Sheet Music to Strudel] Compiler validation:', errors)
  }

  return { code, errors }
}

// ── Step 9 — auto-fix invalid output ─────────────────────────────────────────

function autoFixCode(code) {
  let fixCount = 0
  const lines = code.split('\n')
  const fixed = lines.map(line => {
    let out = line

    // Fix 1: invalid sound names
    const soundMatch = out.match(/\.sound\("([^"]+)"\)/)
    if (soundMatch) {
      const name = soundMatch[1]
      if (!KNOWN_GOOD_SOUNDS.includes(name)) {
        let replacement
        if (name.includes('piano'))                                  replacement = 'gm_acoustic_grand_piano'
        else if (name.includes('bass'))                              replacement = 'gm_acoustic_bass'
        else if (name.includes('violin') || name.includes('string')) replacement = 'gm_violin'
        else if (name.includes('flute') || name.includes('wind'))    replacement = 'gm_flute'
        else if (name.includes('guitar'))                            replacement = 'gm_acoustic_guitar_nylon'
        else if (name.includes('trumpet') || name.includes('brass')) replacement = 'gm_trumpet'
        else                                                         replacement = 'gm_acoustic_grand_piano'
        out = out.replace(soundMatch[0], `.sound("${replacement}")`)
        fixCount++
      }
    }

    // Fix 2: @0.5 @0.25 @0.125 — invalid modifiers
    if (/@0\.(5|25|125)\b/.test(out)) {
      console.warn('[autoFix] Invalid @ modifier in line:', out)
      out = out.replace(/@0\.5\b/g, '')
      out = out.replace(/@0\.25\b/g, '')
      out = out.replace(/@0\.125\b/g, '')
      fixCount++
    }

    // Fix 3: division by zero
    if (/>\s*\/\s*0/.test(out)) {
      console.warn('[autoFix] Division by zero in line:', out)
      out = out.replace(/\/\s*0\b/, '/1')
      fixCount++
    }

    // Fix 4: note() with empty string
    if (/note\(""\)/.test(out)) {
      console.warn('[autoFix] Empty note pattern in line:', out)
      out = out.replace(/note\(""\)/, 'note("~ ~ ~ ~")')
      fixCount++
    }

    // Fix 5: unclosed brackets in note() pattern strings
    const noteMatch = out.match(/note\("(.+)"\)/)
    if (noteMatch) {
      let inner = noteMatch[1]
      const openSquare  = (inner.match(/\[/g) ?? []).length
      const closeSquare = (inner.match(/\]/g) ?? []).length
      if (openSquare > closeSquare) {
        inner += ']'.repeat(openSquare - closeSquare)
        out = out.replace(noteMatch[0], `note("${inner}")`)
        console.warn('[autoFix] Fixed unclosed brackets')
        fixCount++
      }
    }

    return out
  })

  if (fixCount > 0) {
    console.log(`[autoFix] Applied ${fixCount} fix(es)`)
  }
  return fixed.join('\n')
}

// ── Instrument / label tables ─────────────────────────────────────────────────

const VALID_INSTRUMENTS = {
  treble: 'gm_acoustic_grand_piano',
  bass:   'gm_acoustic_bass',
  staff2: 'gm_violin',
  staff3: 'gm_cello',
  staff4: 'gm_flute',
}

const KNOWN_GOOD_SOUNDS = [
  'gm_acoustic_grand_piano',
  'gm_bright_acoustic_piano',
  'gm_electric_grand_piano',
  'gm_honky_tonk_piano',
  'gm_electric_piano_1',
  'gm_electric_piano_2',
  'gm_harpsichord',
  'gm_clavi',
  'gm_celesta',
  'gm_glockenspiel',
  'gm_music_box',
  'gm_vibraphone',
  'gm_marimba',
  'gm_xylophone',
  'gm_tubular_bells',
  'gm_dulcimer',
  'gm_drawbar_organ',
  'gm_percussive_organ',
  'gm_rock_organ',
  'gm_church_organ',
  'gm_reed_organ',
  'gm_accordion',
  'gm_harmonica',
  'gm_tango_accordion',
  'gm_acoustic_guitar_nylon',
  'gm_acoustic_guitar_steel',
  'gm_electric_guitar_jazz',
  'gm_electric_guitar_clean',
  'gm_electric_guitar_muted',
  'gm_overdriven_guitar',
  'gm_distortion_guitar',
  'gm_guitar_harmonics',
  'gm_acoustic_bass',
  'gm_electric_bass_finger',
  'gm_electric_bass_pick',
  'gm_fretless_bass',
  'gm_slap_bass_1',
  'gm_slap_bass_2',
  'gm_synth_bass_1',
  'gm_synth_bass_2',
  'gm_violin',
  'gm_viola',
  'gm_cello',
  'gm_contrabass',
  'gm_tremolo_strings',
  'gm_pizzicato_strings',
  'gm_orchestral_harp',
  'gm_timpani',
  'gm_string_ensemble_1',
  'gm_string_ensemble_2',
  'gm_synth_strings_1',
  'gm_synth_strings_2',
  'gm_choir_aahs',
  'gm_voice_oohs',
  'gm_synth_voice',
  'gm_orchestra_hit',
  'gm_trumpet',
  'gm_trombone',
  'gm_tuba',
  'gm_muted_trumpet',
  'gm_french_horn',
  'gm_brass_section',
  'gm_synth_brass_1',
  'gm_synth_brass_2',
  'gm_soprano_sax',
  'gm_alto_sax',
  'gm_tenor_sax',
  'gm_baritone_sax',
  'gm_oboe',
  'gm_english_horn',
  'gm_bassoon',
  'gm_clarinet',
  'gm_piccolo',
  'gm_flute',
  'gm_recorder',
  'gm_pan_flute',
  'gm_blown_bottle',
  'gm_shakuhachi',
  'gm_whistle',
  'gm_ocarina',
  'gm_lead_1_square',
  'gm_lead_2_sawtooth',
  'gm_lead_3_calliope',
  'gm_lead_4_chiff',
  'gm_lead_5_charang',
  'gm_lead_6_voice',
  'gm_lead_7_fifths',
  'gm_lead_8_bass_lead',
  'gm_pad_1_new_age',
  'gm_pad_2_warm',
  'gm_pad_3_polysynth',
  'gm_pad_4_choir',
  'gm_pad_5_bowed',
  'gm_pad_6_metallic',
  'gm_pad_7_halo',
  'gm_pad_8_sweep',
  'piano',
  'sawtooth',
  'square',
  'triangle',
  'sine',
]

function getValidSound(soundName) {
  if (KNOWN_GOOD_SOUNDS.includes(soundName)) return soundName
  if (soundName.includes('piano'))                                  return 'gm_acoustic_grand_piano'
  if (soundName.includes('bass'))                                   return 'gm_acoustic_bass'
  if (soundName.includes('violin') || soundName.includes('string')) return 'gm_violin'
  if (soundName.includes('flute') || soundName.includes('wind'))    return 'gm_flute'
  if (soundName.includes('guitar'))                                 return 'gm_acoustic_guitar_nylon'
  if (soundName.includes('trumpet') || soundName.includes('brass')) return 'gm_trumpet'
  return 'gm_acoustic_grand_piano'
}

const VOICE_LABELS = {
  treble: 'Right hand (Treble clef)',
  bass:   'Left hand (Bass clef)',
  staff2: 'Voice 2',
  staff3: 'Voice 3',
  staff4: 'Voice 4',
}

// ── Step 10 — main export ─────────────────────────────────────────────────────

/**
 * Converts validated music JSON (from claudeApi.js or musicXmlParser.js) into
 * a complete Strudel JavaScript source string.
 *
 * @param {object} json        Validated music JSON
 * @param {object} patternMap  Visual pattern hints from scoreAnalyzer (reserved)
 * @returns {string}           Strudel source code
 */
export function compileToStrudel(json, patternMap = {}) { // eslint-disable-line no-unused-vars
  const { bpm, timeSignature, title, key, sections } = json
  const beatsPerMeasure = Array.isArray(timeSignature) ? timeSignature[0] : 4
  const tsStr           = Array.isArray(timeSignature) ? timeSignature.join('/') : '4/4'

  const lines = []
  lines.push(`// Generated by Sheet Music to Strudel`)
  lines.push(`// Title: ${title || 'Unknown'}`)
  if (key) lines.push(`// Key: ${key}`)
  lines.push(`// Time: ${tsStr} | BPM: ${bpm || 120}`)
  lines.push(``)
  lines.push(`setcps(${bpm || 120}/60/${beatsPerMeasure})`)
  lines.push(``)

  const allMeasures = (sections ?? []).flatMap(s => s.measures ?? [])

  if (allMeasures.length === 0) {
    lines.push('// No notes detected')
    const code = autoFixCode(lines.join('\n'))
    validateOutput(code)
    return code
  }

  const voices = VOICE_NAMES.filter(v =>
    allMeasures.some(m => m[v] && m[v].length > 0)
  )

  // Phase 1: build condensed measure strings for all voices (Rules 2 & 3)
  const voiceMeasures = {}
  for (const voice of voices) {
    voiceMeasures[voice] = allMeasures.map(m => {
      const pat = measureToPatternString(m, beatsPerMeasure)
      return condenseMeasure(pat[voice] ?? ('~@' + beatsPerMeasure))
    })
  }

  // Phase 2: determine which voices get arrange() vs flat inline
  const voiceUseArrange = {}
  for (const voice of voices) {
    const strs = voiceMeasures[voice]
    const uniqueCount = new Set(strs).size
    voiceUseArrange[voice] = uniqueCount < strs.length && strs.length > 4
  }

  // Phase 3: global pattern registry for cross-voice dedup (Rule 4)
  // patStr → canonical varName shared across all voices that use arrange()
  const patternRegistry = new Map()
  let patternIdx = 0
  for (const voice of voices) {
    if (!voiceUseArrange[voice]) continue
    for (const patStr of voiceMeasures[voice]) {
      if (!patternRegistry.has(patStr)) {
        patternRegistry.set(patStr, `pattern_${patternIdx++}`)
      }
    }
  }

  // Phase 4: generate code
  const declaredVars = new Set()
  let debugVarCount = 0

  for (const voice of voices) {
    lines.push(`// ${VOICE_LABELS[voice] ?? voice}`)
    const measureStrs = voiceMeasures[voice]
    const sound = getValidSound(VALID_INSTRUMENTS[voice])

    if (voiceUseArrange[voice]) {
      // Declare const for each unique pattern not yet declared by a prior voice (Rule 4)
      for (const patStr of [...new Set(measureStrs)]) {
        const varName = patternRegistry.get(patStr)
        if (!declaredVars.has(varName)) {
          const fullValue = `"<[${patStr}]>/1"`
          lines.push(`const ${varName} = ${fullValue}`)
          if (debugVarCount < 3) {
            console.log(`[strudelCompiler] const ${varName} =`, fullValue)
            debugVarCount++
          }
          declaredVars.add(varName)
        }
      }

      lines.push(``)
      lines.push(`$: arrange(`)

      // Merge consecutive identical labels (Rules 1 & 5)
      const labels = measureStrs.map(s => patternRegistry.get(s))
      const merged = mergeArrangeEntries(labels)
      for (const { label, count } of merged) {
        lines.push(`  [${count}, note(${label}).sound("${sound}").room(0.3)],`)
      }

      lines.push(`)`)
    } else {
      // No significant repeats or short piece: flat inline pattern
      const N     = measureStrs.length
      const inner = measureStrs.map(m => '[' + m + ']').join(' ')
      lines.push(`$: note("<${inner}>/${N}")`)
      lines.push(`  .sound("${sound}")`)
      lines.push(`  .room(0.3)`)
    }

    lines.push(``)
  }

  const rawCode = lines.join('\n')
  const fixedCode = autoFixCode(rawCode)
  validateOutput(fixedCode)
  return fixedCode
}
