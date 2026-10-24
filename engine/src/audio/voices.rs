//! The instruments: each a small, allocation-free voice.
//!
//! Voices render one sample at a time into a [`Placement`]: the stereo gains,
//! reverb send and distance cut that the vantage gave them at the note's
//! start. Most are synthesized from the place (the skyline pad, modal bells
//! and mallets on sonido's `ModalBank`, the harp); the theme's piano is
//! sampled.

use super::Noise;
use super::skyline::SkylineTables;
use crate::music::midi_hz;
use sonido_core::{OnePole, StateVariableFilter};
use sonido_synth::modal::{Mallet, ModalBank, Mode, presets};
use sonido_synth::{Oscillator, OscillatorWaveform};

/// Where a voice sits: stereo gains, reverb send, and a distance high-cut.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placement {
    /// Left gain.
    pub gl: f32,
    /// Right gain.
    pub gr: f32,
    /// Reverb send.
    pub send: f32,
    /// One-pole coefficient of the distance high-cut (0 = no cut).
    pub cut: f32,
    /// Send into the canyon's own echo.
    pub canyon: f32,
}

impl Default for Placement {
    fn default() -> Self {
        Placement {
            gl: core::f32::consts::FRAC_1_SQRT_2,
            gr: core::f32::consts::FRAC_1_SQRT_2,
            send: 0.25,
            cut: 0.0,
            canyon: 0.0,
        }
    }
}

/// How a mallet hits a modal voice.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Hit {
    /// Velocity, 0–1.
    pub vel: f32,
    /// Mallet hardness, 0 soft – 1 hard.
    pub hardness: f32,
    /// Output gain.
    pub gain: f32,
}

/// A stereo frame plus sends.
#[derive(Clone, Copy, Debug, Default)]
pub struct Out {
    /// Dry left.
    pub l: f32,
    /// Dry right.
    pub r: f32,
    /// Reverb send.
    pub send: f32,
    /// Canyon echo send.
    pub canyon: f32,
}

impl Out {
    #[inline]
    fn add(&mut self, x: f32, p: &Placement, z: &mut f32) {
        // The distance cut: a one-pole low-pass per voice.
        let y = if p.cut > 0.0 {
            *z += (x - *z) * (1.0 - p.cut);
            *z
        } else {
            x
        };
        self.l += y * p.gl;
        self.r += y * p.gr;
        self.send += y * p.send;
        self.canyon += y * p.canyon;
    }
}

/// A simple envelope: linear attack, exponential decay to sustain,
/// exponential release.
#[derive(Clone, Copy, Debug, Default)]
pub struct Env {
    /// Current level.
    pub level: f32,
    attack_step: f32,
    decay: f32,
    sustain: f32,
    release: f32,
    stage: u8,
}

fn coeff(seconds: f32, sr: f32) -> f32 {
    libm::expf(-1.0 / (seconds.max(1e-4) * sr))
}

impl Env {
    /// Start: attack, decay and release in seconds, sustain 0–1.
    pub fn start(&mut self, attack: f32, decay: f32, sustain: f32, release: f32, sr: f32) {
        self.attack_step = 1.0 / (attack.max(1e-4) * sr);
        self.decay = coeff(decay, sr);
        self.sustain = sustain;
        self.release = coeff(release, sr);
        self.stage = 1;
    }

    /// Begin the release.
    pub fn release(&mut self) {
        if self.stage != 0 {
            self.stage = 3;
        }
    }

    /// `true` once silent.
    pub fn is_done(&self) -> bool {
        self.stage == 0
    }

    /// Advance one sample; the level.
    #[inline]
    pub fn step(&mut self) -> f32 {
        match self.stage {
            1 => {
                self.level += self.attack_step;
                if self.level >= 1.0 {
                    self.level = 1.0;
                    self.stage = 2;
                }
            }
            2 => self.level = self.sustain + (self.level - self.sustain) * self.decay,
            3 => {
                self.level *= self.release;
                if self.level < 1e-4 {
                    self.level = 0.0;
                    self.stage = 0;
                }
            }
            _ => {}
        }
        self.level
    }
}

// --- Piano -----------------------------------------------------------------

/// One decoded piano sample.
#[derive(Clone, Debug)]
pub struct PianoSample {
    /// The note it was recorded at.
    pub midi: u8,
    /// Its sample rate.
    pub rate: f32,
    /// Mono PCM.
    pub data: Vec<i16>,
}

/// A sampled piano note.
#[derive(Clone, Debug, Default)]
pub struct PianoVoice {
    active: bool,
    sample: usize,
    pos: f64,
    inc: f64,
    gain: f32,
    hold: u32,
    env: f32,
    release: f32,
    tone: f32,
    tone_z: f32,
    place: Placement,
    z: f32,
    /// The welcome plays outside the stream's fade.
    pub welcome: bool,
}

impl PianoVoice {
    /// Start a note on the nearest sample.
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        &mut self,
        samples: &[PianoSample],
        midi: f32,
        vel: f32,
        dur_s: f32,
        sr: f32,
        place: Placement,
        welcome: bool,
    ) -> bool {
        let Some((i, s)) = samples.iter().enumerate().min_by(|a, b| {
            (f32::from(a.1.midi) - midi)
                .abs()
                .total_cmp(&(f32::from(b.1.midi) - midi).abs())
        }) else {
            return false;
        };
        self.active = true;
        self.sample = i;
        self.pos = 0.0;
        self.inc = f64::from(libm::exp2f((midi - f32::from(s.midi)) / 12.0) * s.rate / sr);
        // A gentle velocity curve.
        self.gain = 0.12 + 0.88 * vel * vel;
        self.hold = (dur_s * sr) as u32;
        self.env = 1.0;
        self.release = coeff(0.35, sr);
        // Softer notes are darker: a one-pole that opens with velocity.
        let fc = 1800.0 + 9000.0 * vel;
        self.tone = libm::expf(-2.0 * core::f32::consts::PI * fc / sr);
        self.tone_z = 0.0;
        self.place = place;
        self.z = 0.0;
        self.welcome = welcome;
        true
    }

    /// `true` while sounding.
    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Render one sample.
    #[inline]
    pub fn tick(&mut self, samples: &[PianoSample], out: &mut Out) {
        if !self.active {
            return;
        }
        let Some(s) = samples.get(self.sample) else {
            self.active = false;
            return;
        };
        let i = self.pos as usize;
        if i + 1 >= s.data.len() {
            self.active = false;
            return;
        }
        let frac = (self.pos - i as f64) as f32;
        let a = f32::from(s.data[i]);
        let b = f32::from(s.data[i + 1]);
        let mut x = (a + (b - a) * frac) * (1.0 / 32768.0);
        // Fade the last 2000 samples of a trimmed sample.
        let left = s.data.len() - i;
        if left < 2000 {
            x *= left as f32 / 2000.0;
        }
        self.tone_z = x + (self.tone_z - x) * self.tone;
        self.pos += self.inc;
        if self.hold > 0 {
            self.hold -= 1;
        } else {
            self.env *= self.release;
            if self.env < 1e-4 {
                self.active = false;
            }
        }
        let y = self.tone_z * self.gain * self.env;
        out.add(y, &self.place, &mut self.z);
    }
}

// --- Pad ---------------------------------------------------------------------

/// A skyline pad voice: two slightly detuned readers of the skyline table.
#[derive(Clone, Debug)]
pub struct PadVoice {
    active: bool,
    phase: [f32; 2],
    inc: [f32; 2],
    level: usize,
    env: Env,
    filter: StateVariableFilter,
    gain: f32,
    place: Placement,
    z: f32,
    /// MIDI note, for retargeting.
    pub midi: i32,
}

impl PadVoice {
    /// A silent pad voice.
    pub fn new(sr: f32) -> Self {
        let mut filter = StateVariableFilter::new(sr);
        filter.set_resonance(0.6);
        PadVoice {
            active: false,
            phase: [0.0, 0.37],
            inc: [0.0; 2],
            level: 0,
            env: Env::default(),
            filter,
            gain: 0.0,
            place: Placement::default(),
            z: 0.0,
            midi: 0,
        }
    }

    /// Start a note.
    pub fn start(&mut self, midi: i32, sr: f32, cutoff: f32, gain: f32, place: Placement) {
        let f = midi_hz(midi as f32);
        let detune = libm::exp2f(5.0 / 1200.0);
        self.inc = [f * detune / sr, f / detune / sr];
        self.level = SkylineTables::level_for(f, sr);
        self.env.start(1.4, 2.0, 0.85, 2.6, sr);
        self.filter.set_cutoff(cutoff);
        self.gain = gain;
        self.place = place;
        self.active = true;
        self.midi = midi;
    }

    /// Let go.
    pub fn release(&mut self) {
        self.env.release();
    }

    /// `true` while sounding.
    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Move the brightness.
    pub fn set_cutoff(&mut self, cutoff: f32) {
        self.filter.set_cutoff(cutoff);
    }

    /// Render one sample.
    #[inline]
    pub fn tick(&mut self, tables: &SkylineTables, haze: f32, out: &mut Out) {
        if !self.active {
            return;
        }
        let e = self.env.step();
        if self.env.is_done() {
            self.active = false;
            return;
        }
        let mut x = 0.0;
        for k in 0..2 {
            x += tables.read(self.phase[k], haze, self.level);
            self.phase[k] += self.inc[k];
            if self.phase[k] >= 1.0 {
                self.phase[k] -= 1.0;
            }
        }
        let (lp, _, _, _) = self.filter.process_all(x * 0.5);
        out.add(lp * e * self.gain, &self.place, &mut self.z);
    }
}

// --- Bass and the lake -------------------------------------------------------

/// A one-pole DC blocker: y[n] = x[n] − x[n−1] + R·y[n−1].
#[derive(Clone, Copy, Debug)]
struct DcBlock {
    x1: f32,
    y1: f32,
    r: f32,
}

impl DcBlock {
    fn new(sr: f32) -> Self {
        // A corner near 10 Hz.
        DcBlock {
            x1: 0.0,
            y1: 0.0,
            r: libm::expf(-2.0 * core::f32::consts::PI * 10.0 / sr),
        }
    }

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let y = x - self.x1 + self.r * self.y1;
        self.x1 = x;
        self.y1 = y;
        y
    }
}

/// The bass: triangle and saw through a low-pass, with asymmetric
/// saturation so a phone speaker hears its octave.
#[derive(Clone, Debug)]
pub struct Bass {
    tri: Oscillator,
    saw: Oscillator,
    filter: StateVariableFilter,
    dc: DcBlock,
    env: Env,
    hold: u32,
    gain: f32,
    place: Placement,
    z: f32,
}

impl Bass {
    /// A silent bass.
    pub fn new(sr: f32) -> Self {
        let mut tri = Oscillator::new(sr);
        tri.set_waveform(OscillatorWaveform::Triangle);
        let mut saw = Oscillator::new(sr);
        saw.set_waveform(OscillatorWaveform::Saw);
        let mut filter = StateVariableFilter::new(sr);
        filter.set_cutoff(700.0);
        filter.set_resonance(0.8);
        Bass {
            tri,
            saw,
            filter,
            dc: DcBlock::new(sr),
            env: Env::default(),
            hold: 0,
            gain: 0.0,
            place: Placement::default(),
            z: 0.0,
        }
    }

    /// Play a note.
    pub fn start(&mut self, midi: f32, vel: f32, dur_s: f32, sr: f32) {
        let f = midi_hz(midi);
        self.tri.set_frequency(f);
        self.saw.set_frequency(f);
        self.env.start(0.006, 0.35, 0.55, 0.12, sr);
        self.hold = (dur_s * sr) as u32;
        self.gain = 0.55 * vel;
        self.place = Placement {
            send: 0.06,
            ..Placement::default()
        };
    }

    /// Render one sample.
    #[inline]
    pub fn tick(&mut self, out: &mut Out) {
        if self.env.is_done() {
            return;
        }
        if self.hold > 0 {
            self.hold -= 1;
            if self.hold == 0 {
                self.env.release();
            }
        }
        let e = self.env.step();
        let x = 0.75 * self.tri.advance() + 0.25 * self.saw.advance();
        let (lp, _, _, _) = self.filter.process_all(x);
        // An even-order term puts an octave above every note, so a phone
        // speaker that can't play the fundamental still hears the line
        // (noodles D11's phone bass). |x| does it at any level.
        let shaped = self.dc.process(lp + 0.6 * lp.abs());
        out.add(shaped * e * self.gain, &self.place, &mut self.z);
    }
}

/// The lake's pedal: a sine on the key's tonic, low, with its harmonic
/// shadow for phone speakers, gliding when the key moves and breathing with
/// the lake's slosh. The pedal sits at 41–78 Hz and a phone plays little
/// under about 500 Hz, so the shadow reaches up to the 6th and 8th partials
/// (250–620 Hz): enough for the ear to hear the low note that isn't there.
#[derive(Clone, Debug)]
pub struct LakePedal {
    s: f32,
    c: f32,
    freq: f32,
    target: f32,
    glide: f32,
    level: f32,
    breath_phase: f32,
    breath: f32,
    rot: (f32, f32),
    counter: u32,
    sr: f32,
}

impl LakePedal {
    /// A silent pedal.
    pub fn new(sr: f32) -> Self {
        LakePedal {
            s: 0.0,
            c: 1.0,
            freq: 41.2,
            target: 41.2,
            glide: coeff(1.5, sr),
            level: 0.0,
            breath_phase: 0.0,
            breath: 1.0,
            rot: (1.0, 0.0),
            counter: 0,
            sr,
        }
    }

    /// Glide to a new tonic.
    pub fn set_note(&mut self, midi: f32) {
        self.target = midi_hz(midi);
    }

    /// Render one sample at `level` (0–1), breathing by `slosh` (0–1).
    ///
    /// The tone is a rotating phasor and its partials come from double- and
    /// triple-angle identities, so a sample costs no sines.
    #[inline]
    pub fn tick(&mut self, level: f32, slosh: f32, out: &mut Out) {
        self.counter += 1;
        if self.counter >= 64 {
            self.counter = 0;
            self.freq = self.target + (self.freq - self.target) * libm::powf(self.glide, 64.0);
            let w = 2.0 * core::f32::consts::PI * self.freq / self.sr;
            self.rot = (libm::cosf(w), libm::sinf(w));
            // A slow swell, about every 21 seconds, deeper when the lake
            // sloshes.
            self.breath_phase += 64.0 * 0.047 / self.sr;
            if self.breath_phase >= 1.0 {
                self.breath_phase -= 1.0;
            }
            self.breath = 1.0
                - (0.15 + 0.35 * slosh)
                    * (0.5 + 0.5 * libm::sinf(2.0 * core::f32::consts::PI * self.breath_phase));
            // Keep the phasor on the unit circle.
            let m = 1.5 - 0.5 * (self.s * self.s + self.c * self.c);
            self.s *= m;
            self.c *= m;
        }
        self.level += (level - self.level) * 0.0002;
        let (rc, rs) = self.rot;
        let (s, c) = (self.s * rc + self.c * rs, self.c * rc - self.s * rs);
        self.s = s;
        self.c = c;
        let s2 = 2.0 * s * c;
        let c2 = 1.0 - 2.0 * s * s;
        let s4 = 2.0 * s2 * c2;
        let c4 = 1.0 - 2.0 * s2 * s2;
        let s6 = s2 * (3.0 - 4.0 * s2 * s2);
        let s8 = 2.0 * s4 * c4;
        let x = s + 0.3 * s2 + 0.14 * s4 + 0.06 * s6 + 0.07 * s8;
        let y = x * 0.32 * self.level * self.breath;
        out.l += y * 0.7;
        out.r += y * 0.7;
        out.send += y * 0.05;
    }
}

// --- Drums -----------------------------------------------------------------

/// Which drum.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DrumKind {
    /// Soft kick.
    Kick,
    /// Brushed snare.
    Snare,
    /// Rim click (modal).
    Rim,
    /// Closed hat.
    Hat,
    /// Shaker.
    Shaker,
    /// Tom.
    Tom,
    /// Soft crash.
    Crash,
    /// A cymbal swell: noise rising to a peak, then a short ring.
    Swell,
}

/// One drum hit.
#[derive(Clone, Debug)]
pub struct DrumVoice {
    active: bool,
    kind: DrumKind,
    t: u32,
    noise: Noise,
    phase: f32,
    f_start: f32,
    f_end: f32,
    pitch_coeff: f32,
    pitch: f32,
    amp: f32,
    amp_coeff: f32,
    body: f32,
    body_coeff: f32,
    attack: u32,
    filter: StateVariableFilter,
    modal: ModalBank<2>,
    mallet: Mallet,
    gain: f32,
    sr: f32,
    place: Placement,
    z: f32,
}

/// Inharmonic modes of a small cymbal.
const CYMBAL: &[Mode] = &[
    Mode::new(1.0, 1.0, 2.4),
    Mode::new(1.47, 0.8, 2.1),
    Mode::new(2.09, 0.7, 1.8),
    Mode::new(2.56, 0.6, 1.6),
    Mode::new(3.01, 0.5, 1.3),
    Mode::new(3.73, 0.4, 1.1),
    Mode::new(4.41, 0.3, 0.9),
    Mode::new(5.2, 0.25, 0.7),
];

impl DrumVoice {
    /// A silent drum.
    pub fn new(sr: f32, seed: u32) -> Self {
        DrumVoice {
            active: false,
            kind: DrumKind::Kick,
            t: 0,
            noise: Noise::new(seed),
            phase: 0.0,
            f_start: 0.0,
            f_end: 0.0,
            pitch_coeff: 0.0,
            pitch: 0.0,
            amp: 0.0,
            amp_coeff: 0.0,
            body: 0.0,
            body_coeff: 0.0,
            attack: 0,
            filter: StateVariableFilter::new(sr),
            modal: ModalBank::new(sr),
            mallet: Mallet::new(sr),
            gain: 0.0,
            sr,
            place: Placement::default(),
            z: 0.0,
        }
    }

    /// `true` while sounding.
    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Hit.
    pub fn start(&mut self, kind: DrumKind, midi: f32, vel: f32, place: Placement, seed: u32) {
        let sr = self.sr;
        self.active = true;
        self.kind = kind;
        self.t = 0;
        self.noise = Noise::new(seed);
        self.phase = 0.0;
        self.place = place;
        self.z = 0.0;
        self.gain = vel;
        self.amp = 1.0;
        self.pitch = 1.0;
        self.body = 0.0;
        self.attack = 0;
        match kind {
            DrumKind::Kick => {
                self.f_start = 110.0;
                self.f_end = 46.0;
                self.pitch_coeff = coeff(0.035, sr);
                self.amp_coeff = coeff(0.28, sr);
                self.gain *= 0.9;
            }
            DrumKind::Snare => {
                self.filter.set_cutoff(2200.0);
                self.filter.set_resonance(0.9);
                self.amp_coeff = coeff(0.12, sr);
                self.attack = (0.004 * sr) as u32;
                self.f_start = 196.0;
                self.f_end = 196.0;
                self.body = 0.5;
                self.body_coeff = coeff(0.06, sr);
                self.gain *= 0.38;
            }
            DrumKind::Rim => {
                self.modal.set_modes(1150.0, presets::WOODBLOCK);
                self.mallet.strike(1.0, 0.9);
                self.amp_coeff = 1.0;
                self.gain *= 0.6;
            }
            DrumKind::Hat => {
                self.filter.set_cutoff(8000.0);
                self.filter.set_resonance(0.7);
                self.amp_coeff = coeff(0.035, sr);
                self.gain *= 0.18;
            }
            DrumKind::Shaker => {
                self.filter.set_cutoff(6200.0);
                self.filter.set_resonance(1.2);
                self.amp_coeff = coeff(0.05, sr);
                self.attack = (0.009 * sr) as u32;
                self.gain *= 0.16;
            }
            DrumKind::Tom => {
                let f = midi_hz(midi);
                self.f_start = f * 1.25;
                self.f_end = f;
                self.pitch_coeff = coeff(0.08, sr);
                self.amp_coeff = coeff(0.34, sr);
                self.gain *= 0.62;
            }
            DrumKind::Crash => {
                self.filter.set_cutoff(5000.0);
                self.filter.set_resonance(0.6);
                self.amp_coeff = coeff(0.8, sr);
                self.modal.set_modes(420.0, CYMBAL);
                self.mallet.strike(0.6, 1.0);
                self.gain *= 0.22;
            }
            DrumKind::Swell => {
                // Set by `swell`, which gives the rise its length.
                self.filter.set_cutoff(6500.0);
                self.filter.set_resonance(0.7);
                self.amp_coeff = coeff(0.45, sr);
                self.gain *= 0.2;
            }
        }
    }

    /// A cymbal swell rising for `rise_s`, then ringing briefly: a gesture
    /// that needs no kit.
    pub fn swell(&mut self, rise_s: f32, vel: f32, place: Placement, seed: u32) {
        self.start(DrumKind::Swell, 0.0, vel, place, seed);
        self.attack = (rise_s.clamp(0.3, 8.0) * self.sr) as u32;
    }

    /// Render one sample.
    #[inline]
    pub fn tick(&mut self, out: &mut Out) {
        if !self.active {
            return;
        }
        let sr = self.sr;
        self.t += 1;
        let ramp = if self.attack > 0 && self.t < self.attack {
            self.t as f32 / self.attack as f32
        } else {
            1.0
        };
        let x = match self.kind {
            DrumKind::Kick | DrumKind::Tom => {
                self.pitch *= self.pitch_coeff;
                let f = self.f_end + (self.f_start - self.f_end) * self.pitch;
                self.phase += f / sr;
                if self.phase >= 1.0 {
                    self.phase -= 1.0;
                }
                let tone = sonido_core::fast_sin_turns(self.phase);
                let click = if self.t < (0.003 * sr) as u32 {
                    0.25 * self.noise.sample()
                } else {
                    0.0
                };
                self.amp *= self.amp_coeff;
                (tone + click) * self.amp
            }
            DrumKind::Snare => {
                let (_, _, bp, _) = self.filter.process_all(self.noise.sample());
                self.amp *= self.amp_coeff;
                self.body *= self.body_coeff;
                self.phase += self.f_start / sr;
                if self.phase >= 1.0 {
                    self.phase -= 1.0;
                }
                (bp * self.amp + self.body * sonido_core::fast_sin_turns(self.phase)) * ramp
            }
            DrumKind::Hat | DrumKind::Shaker => {
                let (_, hp, bp, _) = self.filter.process_all(self.noise.sample());
                self.amp *= self.amp_coeff;
                let s = if self.kind == DrumKind::Hat { hp } else { bp };
                s * self.amp * ramp
            }
            DrumKind::Rim => self.modal.process(self.mallet.next_sample()),
            DrumKind::Crash => {
                let (_, hp, _, _) = self.filter.process_all(self.noise.sample());
                self.amp *= self.amp_coeff;
                0.5 * hp * self.amp + self.modal.process(self.mallet.next_sample())
            }
            DrumKind::Swell => {
                let (_, hp, _, _) = self.filter.process_all(self.noise.sample());
                // A squared rise (it grows the way a struck-and-rolled
                // cymbal does), then the ring decays.
                let env = if self.t < self.attack {
                    let u = self.t as f32 / self.attack as f32;
                    u * u
                } else {
                    self.amp *= self.amp_coeff;
                    self.amp
                };
                0.6 * hp * env
            }
        };
        let done = match self.kind {
            DrumKind::Rim => {
                !self.mallet.is_active() && self.t.is_multiple_of(256) && self.modal.is_silent()
            }
            DrumKind::Crash => {
                self.amp < 1e-4 && self.t.is_multiple_of(256) && self.modal.is_silent()
            }
            _ => self.amp < 1e-4,
        };
        if done {
            self.active = false;
        }
        out.add(x * self.gain, &self.place, &mut self.z);
    }
}

// --- Modal voices: bells, marimba, snow, quakes ---------------------------------

/// A struck modal voice.
#[derive(Clone, Debug)]
pub struct ModalVoice<const G: usize> {
    active: bool,
    bank: ModalBank<G>,
    mallet: Mallet,
    gain: f32,
    place: Placement,
    z: f32,
    t: u32,
}

impl<const G: usize> ModalVoice<G> {
    /// A silent voice.
    pub fn new(sr: f32) -> Self {
        ModalVoice {
            active: false,
            bank: ModalBank::new(sr),
            mallet: Mallet::new(sr),
            gain: 0.0,
            place: Placement::default(),
            z: 0.0,
            t: 0,
        }
    }

    /// `true` while sounding.
    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Strike explicit partials.
    pub fn strike(&mut self, partials: &[(f32, f32, f32)], hit: Hit, place: Placement) {
        self.bank.reset();
        self.bank.set_partials(partials);
        self.mallet.strike(hit.vel, hit.hardness);
        self.gain = hit.gain;
        self.place = place;
        self.z = 0.0;
        self.t = 0;
        self.active = true;
    }

    /// Strike a preset at `fundamental`.
    pub fn strike_modes(
        &mut self,
        fundamental: f32,
        modes: &[Mode],
        decay_scale: f32,
        hit: Hit,
        place: Placement,
    ) {
        self.bank.reset();
        self.bank
            .set_modes_scaled(fundamental, modes, 1.0, decay_scale);
        self.mallet.strike(hit.vel, hit.hardness);
        self.gain = hit.gain;
        self.place = place;
        self.z = 0.0;
        self.t = 0;
        self.active = true;
    }

    /// Render one sample.
    #[inline]
    pub fn tick(&mut self, out: &mut Out) {
        if !self.active {
            return;
        }
        let y = self.bank.process(self.mallet.next_sample());
        self.t += 1;
        if self.t.is_multiple_of(512) && !self.mallet.is_active() && self.bank.is_silent() {
            self.active = false;
        }
        out.add(y * self.gain, &self.place, &mut self.z);
    }
}

/// A TRAX bell's partials at `f`: harmonic, so it rings in tune with the
/// chord tone it is.
pub fn bell_partials(f: f32) -> [(f32, f32, f32); 6] {
    [
        (f, 1.0, 2.6),
        (2.0 * f, 0.5, 1.7),
        (3.0 * f, 0.26, 0.95),
        (4.0 * f, 0.14, 0.6),
        (5.0 * f, 0.08, 0.4),
        (6.0 * f, 0.05, 0.3),
    ]
}

// --- Horn ----------------------------------------------------------------

/// One chime of FrontRunner's horn: two detuned saws through a filter that
/// opens as the air builds.
#[derive(Clone, Debug)]
pub struct HornVoice {
    a: Oscillator,
    b: Oscillator,
    filter: StateVariableFilter,
    env: Env,
    hold: u32,
    t: u32,
    gain: f32,
    sr: f32,
    place: Placement,
    z: f32,
}

impl HornVoice {
    /// A silent chime.
    pub fn new(sr: f32) -> Self {
        let mut a = Oscillator::new(sr);
        a.set_waveform(OscillatorWaveform::Saw);
        let mut b = Oscillator::new(sr);
        b.set_waveform(OscillatorWaveform::Saw);
        let mut filter = StateVariableFilter::new(sr);
        filter.set_resonance(1.1);
        HornVoice {
            a,
            b,
            filter,
            env: Env::default(),
            hold: 0,
            t: 0,
            gain: 0.0,
            sr,
            place: Placement::default(),
            z: 0.0,
        }
    }

    /// `true` while sounding.
    pub fn is_active(&self) -> bool {
        !self.env.is_done()
    }

    /// Blow.
    pub fn start(&mut self, midi: f32, vel: f32, dur_s: f32, place: Placement) {
        let f = midi_hz(midi);
        self.a.set_frequency(f * libm::exp2f(4.0 / 1200.0));
        self.b.set_frequency(f * libm::exp2f(-4.0 / 1200.0));
        self.env.start(0.035, 0.2, 0.85, 0.16, self.sr);
        self.hold = (dur_s * self.sr) as u32;
        self.t = 0;
        self.gain = 0.09 * vel;
        self.place = place;
        self.z = 0.0;
    }

    /// Render one sample.
    #[inline]
    pub fn tick(&mut self, out: &mut Out) {
        if self.env.is_done() {
            return;
        }
        if self.hold > 0 {
            self.hold -= 1;
            if self.hold == 0 {
                self.env.release();
            }
        }
        self.t += 1;
        if self.t % 64 == 1 {
            let open = (self.t as f32 / (0.07 * self.sr)).min(1.0);
            self.filter.set_cutoff(500.0 + 2300.0 * open);
        }
        let e = self.env.step();
        let x = 0.5 * (self.a.advance() + self.b.advance());
        let (lp, _, _, _) = self.filter.process_all(x);
        out.add(lp * e * self.gain, &self.place, &mut self.z);
    }
}

// --- Planes --------------------------------------------------------------------

/// A plane's swell: brass and strings rising out of nothing and falling away
/// over a few bars, slow enough to be weather and low enough to sit under the
/// bells. The brass is three saws a breath apart, the middle one strongest
/// so their beating never empties the fundamental, through a low-pass that
/// opens as it grows (brass brightens as it's blown harder); the strings are
/// two more saws an octave up and further apart, a shimmer over it with a
/// slower vibrato, left out for a light aircraft; a little breath of noise
/// rides the rise. It
/// peaks late for a departure (climbing away) and early for an arrival
/// (already near, coming down). Nothing like the horn: two low notes, a slow
/// attack, no rhythm.
#[derive(Clone, Debug)]
pub struct SwellVoice {
    brass: [Oscillator; 3],
    strings: [Oscillator; 2],
    brass_lp: StateVariableFilter,
    strings_lp: StateVariableFilter,
    breath_bp: StateVariableFilter,
    noise: Noise,
    /// log2 of the sounding frequency, and of the one it glides to.
    pitch: f32,
    target: f32,
    t: u32,
    len: u32,
    /// Where in its length it peaks, 0–1.
    peak: f32,
    /// How much string there is, 0 (light) to 1.
    strings_on: f32,
    /// How far apart the strings are, ×.
    spread: f32,
    vibrato: [f32; 2],
    e: f32,
    gain: f32,
    sr: f32,
    place: Placement,
    z: f32,
}

/// The swell's control rate, samples.
const SWELL_BLOCK: u32 = 16;

impl SwellVoice {
    /// A silent swell.
    pub fn new(sr: f32, seed: u32) -> Self {
        let saw = || {
            let mut o = Oscillator::new(sr);
            o.set_waveform(OscillatorWaveform::Saw);
            o
        };
        let filter = |q: f32| {
            let mut f = StateVariableFilter::new(sr);
            f.set_resonance(q);
            f
        };
        SwellVoice {
            brass: [saw(), saw(), saw()],
            strings: [saw(), saw()],
            brass_lp: filter(0.75),
            strings_lp: filter(0.6),
            breath_bp: filter(1.5),
            noise: Noise::new(seed),
            pitch: 0.0,
            target: 0.0,
            t: 0,
            len: 0,
            peak: 0.7,
            strings_on: 1.0,
            spread: 1.0,
            vibrato: [0.0, 0.25],
            e: 0.0,
            gain: 0.0,
            sr,
            place: Placement::default(),
            z: 0.0,
        }
    }

    /// `true` while sounding.
    pub fn is_active(&self) -> bool {
        self.t < self.len
    }

    /// Swell for `dur_s`: a departure's peaks late, an arrival's early; a
    /// plane's size (1 light – 5 heavy) sets how much string and how wide.
    pub fn start(
        &mut self,
        midi: f32,
        vel: f32,
        dur_s: f32,
        arrival: bool,
        size: u8,
        place: Placement,
    ) {
        self.pitch = libm::log2f(midi_hz(midi));
        self.target = self.pitch;
        self.t = 0;
        self.len = (dur_s.clamp(1.0, 30.0) * self.sr) as u32;
        self.peak = if arrival { 0.25 } else { 0.7 };
        self.strings_on = if size <= 2 { 0.0 } else { 1.0 };
        self.spread = 0.7 + 0.175 * f32::from(size.clamp(1, 5) - 1);
        self.gain = 0.12 * vel;
        self.place = place;
        self.z = 0.0;
        self.e = 0.0;
        for (i, o) in self
            .brass
            .iter_mut()
            .chain(self.strings.iter_mut())
            .enumerate()
        {
            o.set_phase(0.23 * i as f32);
        }
        self.retune();
    }

    /// Move to `midi`, legato, over about a fifth of a second.
    pub fn glide_to(&mut self, midi: f32) {
        self.target = libm::log2f(midi_hz(midi));
    }

    /// The envelope at `u` of the way through: a smooth rise to the peak,
    /// then a fall away, squared.
    pub fn envelope(u: f32, peak: f32) -> f32 {
        if u < peak {
            let x = u / peak;
            x * x * (3.0 - 2.0 * x)
        } else {
            let x = 1.0 - (u - peak) / (1.0 - peak);
            (x * x).max(0.0)
        }
    }

    fn retune(&mut self) {
        let f0 = libm::exp2f(self.pitch);
        let u = self.t as f32 / self.len.max(1) as f32;
        // The vibrato comes in as the swell matures.
        let depth = if u > 0.3 && self.e > 0.6 {
            ((u - 0.3) / 0.2).min(1.0)
        } else {
            0.0
        };
        let vib = |phase: f32, cents: f32| {
            libm::exp2f(depth * cents / 1200.0 * sonido_core::fast_sin_turns(phase))
        };
        let bv = vib(self.vibrato[0], 7.0);
        let sv = vib(self.vibrato[1], 5.0);
        let cents = |c: f32| libm::exp2f(c / 1200.0);
        self.brass[0].set_frequency(f0 * cents(-7.0) * bv);
        self.brass[1].set_frequency(f0 * bv);
        self.brass[2].set_frequency(f0 * cents(5.0) * bv);
        self.strings[0].set_frequency(2.0 * f0 * cents(-9.0 * self.spread) * sv);
        self.strings[1].set_frequency(2.0 * f0 * cents(9.0 * self.spread) * sv);
        let e = self.e;
        self.brass_lp
            .set_cutoff((f0 * (1.3 + 9.0 * e * libm::sqrtf(e))).clamp(70.0, 4800.0));
        self.strings_lp
            .set_cutoff((f0 * (2.5 + 6.0 * e)).clamp(200.0, 3200.0));
        self.breath_bp.set_cutoff((2.2 * f0).clamp(350.0, 1600.0));
    }

    /// Render one sample.
    #[inline]
    pub fn tick(&mut self, out: &mut Out) {
        if self.t >= self.len {
            return;
        }
        if self.t.is_multiple_of(SWELL_BLOCK) {
            let block = SWELL_BLOCK as f32 / self.sr;
            self.e = Self::envelope(self.t as f32 / self.len as f32, self.peak);
            // A glide settles in about 0.3 s.
            self.pitch += (self.target - self.pitch) * (1.0 - libm::expf(-block / 0.06));
            self.vibrato[0] = (self.vibrato[0] + 4.7 * block).fract();
            self.vibrato[1] = (self.vibrato[1] + 5.4 * block).fract();
            self.retune();
        }
        self.t += 1;
        let e = self.e;
        let brass = 0.2 * self.brass[0].advance()
            + 0.6 * self.brass[1].advance()
            + 0.2 * self.brass[2].advance();
        let (brass, _, _, _) = self.brass_lp.process_all(brass);
        let strings = 0.55 * self.strings[0].advance() + 0.45 * self.strings[1].advance();
        let (strings, _, _, _) = self.strings_lp.process_all(strings);
        let (_, _, breath, _) = self.breath_bp.process_all(self.noise.sample());
        let breath = breath * (0.1 * e * (1.0 - e) + 0.015 * e);
        let x = 0.7 * brass + 0.3 * self.strings_on * strings + breath;
        out.add(x * e * self.gain, &self.place, &mut self.z);
    }
}

// --- Harp and air --------------------------------------------------------------

/// Longest harp string, in samples (about 40 Hz at 48 kHz).
const HARP_MAX: usize = 1200;

/// A Karplus–Strong string of the Aeolian harp.
#[derive(Clone, Debug)]
pub struct HarpString {
    buf: Vec<f32>,
    len: usize,
    pos: usize,
    loop_gain: f32,
    last: f32,
    active: bool,
    quiet: u32,
    gain: f32,
    place: Placement,
    z: f32,
}

impl HarpString {
    /// A silent string.
    pub fn new() -> Self {
        HarpString {
            buf: vec![0.0; HARP_MAX],
            len: 100,
            pos: 0,
            loop_gain: 0.99,
            last: 0.0,
            active: false,
            quiet: 0,
            gain: 0.0,
            place: Placement::default(),
            z: 0.0,
        }
    }

    /// `true` while sounding.
    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Excite with a soft noise burst: the wind on the string.
    pub fn excite(&mut self, midi: f32, vel: f32, sr: f32, noise: &mut Noise, place: Placement) {
        let f = midi_hz(midi);
        self.len = ((sr / f) as usize).clamp(2, HARP_MAX);
        // A 3.5 s decay: loop gain per period.
        let periods = 3.5 * f;
        self.loop_gain = libm::powf(10.0, -3.0 / periods.max(1.0));
        let mut lp = 0.0;
        for i in 0..self.len {
            lp += (noise.sample() - lp) * 0.35;
            self.buf[i] = lp * vel;
        }
        self.pos = 0;
        self.last = 0.0;
        self.active = true;
        self.quiet = 0;
        self.gain = 0.5;
        self.place = place;
        self.z = 0.0;
    }

    /// Render one sample.
    #[inline]
    pub fn tick(&mut self, out: &mut Out) {
        if !self.active {
            return;
        }
        let cur = self.buf[self.pos];
        let next = 0.5 * (cur + self.last) * self.loop_gain;
        self.last = cur;
        self.buf[self.pos] = next;
        self.pos += 1;
        if self.pos >= self.len {
            self.pos = 0;
        }
        if cur.abs() < 1e-5 {
            self.quiet += 1;
            if self.quiet > self.len as u32 * 2 {
                self.active = false;
            }
        } else {
            self.quiet = 0;
        }
        out.add(cur * self.gain, &self.place, &mut self.z);
    }
}

impl Default for HarpString {
    fn default() -> Self {
        Self::new()
    }
}

/// The air under the harp: filtered noise that swells with the wind.
#[derive(Clone, Debug)]
pub struct Air {
    noise: Noise,
    lp: OnePole,
    hp: OnePole,
    level: f32,
    gust_phase: f32,
    swell: f32,
    counter: u32,
    sr: f32,
}

impl Air {
    /// Still air.
    pub fn new(sr: f32) -> Self {
        Air {
            noise: Noise::new(0xA1F),
            lp: OnePole::new(sr, 1100.0),
            hp: OnePole::new(sr, 250.0),
            level: 0.0,
            gust_phase: 0.0,
            swell: 0.6,
            counter: 0,
            sr,
        }
    }

    /// Render one sample at `wind` (m/s) and `gust` (m/s), scaled by `mix`.
    #[inline]
    pub fn tick(&mut self, wind: f32, gust: f32, mix: f32, out: &mut Out) {
        let target = (wind / 25.0).min(1.0) * mix;
        self.level += (target - self.level) * 0.00005;
        self.counter += 1;
        if self.counter >= 64 {
            self.counter = 0;
            self.gust_phase += 64.0 * (0.05 + gust * 0.004) / self.sr;
            if self.gust_phase >= 1.0 {
                self.gust_phase -= 1.0;
            }
            self.swell = 0.6 + 0.4 * libm::sinf(2.0 * core::f32::consts::PI * self.gust_phase);
        }
        let swell = self.swell;
        // A band from 250 Hz to 1.1 kHz: a low-pass, minus its own
        // low-passed copy at 250 Hz.
        let low = self.lp.process(self.noise.sample());
        let x = (low - self.hp.process(low)) * self.level * swell * 0.06;
        out.l += x;
        out.r += x * 0.8;
        out.send += x * 0.3;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    #[test]
    fn the_lake_reaches_a_phone() {
        // The pedal on E1 (41 Hz): its 8th partial, at 330 Hz, is there.
        let mut lake = LakePedal::new(SR);
        lake.set_note(28.0);
        lake.freq = midi_hz(28.0);
        let mut out = Out::default();
        let n = SR as usize;
        let (mut re, mut im, mut all) = (0.0f64, 0.0f64, 0.0f64);
        let w = 2.0 * core::f64::consts::PI * 8.0 * f64::from(midi_hz(28.0)) / f64::from(SR);
        for i in 0..2 * n {
            let before = out.l;
            lake.tick(1.0, 0.0, &mut out);
            let y = f64::from(out.l - before);
            if i >= n {
                re += y * (w * i as f64).cos();
                im += y * (w * i as f64).sin();
                all += y * y;
            }
        }
        let eighth = 2.0 * (re * re + im * im) / n as f64;
        assert!(
            eighth / (all / n as f64) > 0.002,
            "the 8th partial's share {}",
            eighth / (all / n as f64)
        );
    }

    #[test]
    fn envelopes_finish() {
        let mut e = Env::default();
        e.start(0.01, 0.1, 0.5, 0.05, SR);
        // Four decay time constants past the attack.
        for _ in 0..(0.41 * SR) as usize {
            e.step();
        }
        assert!((e.level - 0.5).abs() < 0.05);
        e.release();
        for _ in 0..48_000 {
            e.step();
        }
        assert!(e.is_done());
    }

    #[test]
    fn drums_are_finite_and_finish() {
        for (i, kind) in [
            DrumKind::Kick,
            DrumKind::Snare,
            DrumKind::Rim,
            DrumKind::Hat,
            DrumKind::Shaker,
            DrumKind::Tom,
            DrumKind::Crash,
            DrumKind::Swell,
        ]
        .into_iter()
        .enumerate()
        {
            let mut d = DrumVoice::new(SR, 1);
            d.start(kind, 45.0, 0.8, Placement::default(), i as u32 + 1);
            let mut peak = 0.0f32;
            let mut n = 0;
            while d.is_active() && n < 10 * SR as usize {
                let mut o = Out::default();
                d.tick(&mut o);
                assert!(o.l.is_finite());
                peak = peak.max(o.l.abs());
                n += 1;
            }
            assert!(!d.is_active(), "{kind:?} never finished");
            assert!(peak > 0.005 && peak < 1.5, "{kind:?} peak {peak}");
        }
    }

    #[test]
    fn a_cymbal_swell_rises_for_its_length_then_rings_out() {
        let mut d = DrumVoice::new(SR, 1);
        d.swell(2.0, 0.8, Placement::default(), 7);
        // Loudness in 100 ms blocks.
        let mut blocks = Vec::new();
        let (mut sum, mut n) = (0.0f32, 0);
        while d.is_active() && blocks.len() < 100 {
            let mut o = Out::default();
            d.tick(&mut o);
            assert!(o.l.is_finite());
            sum += o.l * o.l;
            n += 1;
            if n == (SR / 10.0) as usize {
                blocks.push((sum / n as f32).sqrt());
                (sum, n) = (0.0, 0);
            }
        }
        assert!(!d.is_active(), "it rings out");
        let loudest = (0..blocks.len()).max_by(|&a, &b| blocks[a].total_cmp(&blocks[b]));
        assert!(
            matches!(loudest, Some(18..=21)),
            "loudest at block {loudest:?}"
        );
        assert!(blocks[19] > 8.0 * blocks[4], "it grows");
    }

    /// A swell's loudness and brightness (the share of its energy above
    /// 600 Hz, where the breath hardly reaches) in 100 ms blocks.
    fn swell_blocks(arrival: bool, size: u8, glide: Option<(usize, f32)>) -> Vec<(f32, f32)> {
        let mut v = SwellVoice::new(SR, 3);
        v.start(45.0, 0.8, 8.0, arrival, size, Placement::default());
        let mut out = Vec::new();
        let (mut sum, mut slope, mut n) = (0.0f32, 0.0f32, 0);
        let mut high = StateVariableFilter::new(SR);
        high.set_cutoff(600.0);
        high.set_resonance(0.7);
        while v.is_active() {
            let mut o = Out::default();
            v.tick(&mut o);
            assert!(o.l.is_finite());
            sum += o.l * o.l;
            let (_, hp, _, _) = high.process_all(o.l);
            slope += hp * hp;
            n += 1;
            if n == (SR / 10.0) as usize {
                if let Some((at, m)) = glide
                    && out.len() == at
                {
                    v.glide_to(m);
                }
                out.push(((sum / n as f32).sqrt(), slope / sum.max(1e-12)));
                (sum, slope, n) = (0.0, 0.0, 0);
            }
            assert!(out.len() <= 81, "it stops on time");
        }
        out
    }

    #[test]
    fn a_departure_swells_late_and_an_arrival_early_brightening_as_it_grows() {
        for (arrival, lo, hi) in [(false, 48, 64), (true, 16, 28)] {
            let b = swell_blocks(arrival, 4, None);
            assert!((79..=81).contains(&b.len()), "{}", b.len());
            // Loudness over half a second, around each block: the
            // ensemble's beating averages out.
            let smooth = |i: usize| {
                (i.saturating_sub(2)..(i + 3).min(b.len()))
                    .map(|k| b[k].0)
                    .sum::<f32>()
            };
            let peak = (0..b.len())
                .max_by(|&i, &j| smooth(i).total_cmp(&smooth(j)))
                .unwrap();
            assert!(
                (lo..=hi).contains(&peak),
                "arrival {arrival}: peak at block {peak}"
            );
            let shape = |u: f32| SwellVoice::envelope(u, if arrival { 0.25 } else { 0.7 });
            assert_eq!(shape(if arrival { 0.25 } else { 0.7 }), 1.0);
            assert!(shape(0.0) == 0.0 && shape(1.0) == 0.0);
            // Brass opens up as it's blown harder and closes as it fades:
            // brighter at the peak than where it's at a tenth of the peak's
            // loudness on the way down (and, given a departure's long rise,
            // on the way up).
            let bright = |i: usize| {
                let k = i.saturating_sub(2)..(i + 3).min(b.len());
                k.clone().map(|j| b[j].1 * b[j].0 * b[j].0).sum::<f32>()
                    / k.map(|j| b[j].0 * b[j].0).sum::<f32>()
            };
            let tail = (peak..b.len())
                .rev()
                .find(|&i| smooth(i) > 0.1 * smooth(peak))
                .unwrap();
            assert!(
                bright(peak) > 1.5 * bright(tail),
                "brightness {} at the peak, {} at block {tail}",
                bright(peak),
                bright(tail)
            );
            if !arrival {
                let early = (0..peak).find(|&i| smooth(i) > 0.1 * smooth(peak)).unwrap();
                assert!(
                    bright(peak) > 1.5 * bright(early),
                    "brightness {} at the peak, {} at block {early}",
                    bright(peak),
                    bright(early)
                );
            }
            assert!(b[peak].0 > 0.01 && b[peak].0 < 0.5);
        }
    }

    #[test]
    fn a_swell_glides_to_its_next_note_in_a_fifth_of_a_second() {
        let mut v = SwellVoice::new(SR, 3);
        v.start(45.0, 0.8, 4.0, false, 3, Placement::default());
        for _ in 0..(SR as usize) {
            v.tick(&mut Out::default());
        }
        v.glide_to(52.0);
        for _ in 0..((0.3 * SR) as usize) {
            v.tick(&mut Out::default());
        }
        let hz = libm::exp2f(v.pitch);
        assert!((hz / midi_hz(52.0) - 1.0).abs() < 0.01, "{hz}");
        // A light aircraft is brass alone.
        let light = swell_blocks(false, 1, None);
        assert_eq!(light.len(), 80);
    }

    #[test]
    fn harp_rings_and_stops() {
        let mut h = HarpString::new();
        let mut noise = Noise::new(3);
        h.excite(64.0, 0.6, SR, &mut noise, Placement::default());
        let mut n = 0;
        while h.is_active() && n < 12 * SR as usize {
            let mut o = Out::default();
            h.tick(&mut o);
            assert!(o.l.is_finite());
            n += 1;
        }
        assert!(!h.is_active());
        assert!(n > SR as usize, "rang only {n} samples");
    }

    #[test]
    fn bass_has_an_octave_for_phones() {
        let mut b = Bass::new(SR);
        b.start(33.0, 1.0, 1.0, SR); // A1, 55 Hz
        let mut x = Vec::new();
        for _ in 0..24_000 {
            let mut o = Out::default();
            b.tick(&mut o);
            x.push(o.l);
        }
        let level = |f: f32| {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (n, &v) in x[4800..].iter().enumerate() {
                let a = 2.0 * core::f64::consts::PI * f64::from(f) * n as f64 / f64::from(SR);
                re += f64::from(v) * libm::cos(a);
                im += f64::from(v) * libm::sin(a);
            }
            (re * re + im * im).sqrt()
        };
        assert!(level(110.0) > 0.2 * level(55.0), "the octave should carry");
    }
}
