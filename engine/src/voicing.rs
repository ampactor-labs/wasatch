//! Voicing: where each chord tone sits, chosen by ear's proxies.
//!
//! Candidates are the chord's inversions in close and open position inside
//! the pad's range. Each is scored by how far its voices move from the last
//! voicing (voice leading) plus its sensory roughness, summed with
//! Vassilakis's model over every pair of partials the pad will actually
//! produce (Sethares: where consonance falls depends on the timbre). The
//! lowest score wins.

use crate::music::{Chord, midi_hz};

/// Lowest pad note (C3).
pub const PAD_LO: i32 = 48;
/// Highest pad note (D5).
pub const PAD_HI: i32 = 74;
/// Voices in a pad chord.
pub const VOICES: usize = 4;

/// Relative amplitudes of the pad's first harmonics: the skyline wavetable
/// after its k^−0.5 tilt falls about as k^−1.15 (DESIGN.md Appendix D).
const PARTIALS: [f32; 6] = [1.0, 0.45, 0.28, 0.20, 0.157, 0.128];

/// Vassilakis's roughness of two sine partials.
pub fn pair_roughness(f1: f32, a1: f32, f2: f32, a2: f32) -> f32 {
    let (fmin, fmax) = if f1 < f2 { (f1, f2) } else { (f2, f1) };
    let (amin, amax) = if a1 < a2 { (a1, a2) } else { (a2, a1) };
    if amax <= 0.0 {
        return 0.0;
    }
    let s = 0.24 / (0.0207 * fmin + 18.96);
    let df = fmax - fmin;
    let x = libm::powf(amin * amax, 0.1);
    let y = 0.5 * libm::powf(2.0 * amin / (amin + amax), 3.11);
    let z = libm::expf(-3.5 * s * df) - libm::expf(-5.75 * s * df);
    x * y * z
}

/// Roughness of one note's own partials against each other.
fn self_roughness(m: i32) -> f32 {
    let f0 = midi_hz(m as f32);
    let mut r = 0.0;
    for (i, &ai) in PARTIALS.iter().enumerate() {
        for (j, &aj) in PARTIALS.iter().enumerate().skip(i + 1) {
            r += pair_roughness(f0 * (i + 1) as f32, ai, f0 * (j + 1) as f32, aj);
        }
    }
    r
}

/// Roughness between two notes' partials.
fn cross_roughness(a: i32, b: i32) -> f32 {
    let (fa, fb) = (midi_hz(a as f32), midi_hz(b as f32));
    let mut r = 0.0;
    for (i, &pa) in PARTIALS.iter().enumerate() {
        for (j, &pb) in PARTIALS.iter().enumerate() {
            r += pair_roughness(fa * (i + 1) as f32, pa, fb * (j + 1) as f32, pb);
        }
    }
    r
}

const SPAN: usize = (PAD_HI - PAD_LO + 1) as usize;

/// Pairwise roughness over the pad's range, computed once: a voicing's
/// roughness is the sum over its note pairs (plus each note's own), so
/// scoring a candidate costs a handful of lookups instead of hundreds of
/// exponentials on the audio thread.
fn table() -> &'static ([f32; SPAN], [[f32; SPAN]; SPAN]) {
    static TABLE: std::sync::OnceLock<([f32; SPAN], [[f32; SPAN]; SPAN])> =
        std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        let mut own = [0.0f32; SPAN];
        let mut cross = [[0.0f32; SPAN]; SPAN];
        for (i, slot) in own.iter_mut().enumerate() {
            *slot = self_roughness(PAD_LO + i as i32);
            // A symmetric fill writes [i][j] and [j][i].
            #[allow(clippy::needless_range_loop)]
            for j in i + 1..SPAN {
                let r = cross_roughness(PAD_LO + i as i32, PAD_LO + j as i32);
                cross[i][j] = r;
                cross[j][i] = r;
            }
        }
        (own, cross)
    })
}

/// Total roughness of a set of MIDI notes played with the pad's partials.
pub fn roughness(notes: &[i32]) -> f32 {
    let in_range = notes.iter().all(|m| (PAD_LO..=PAD_HI).contains(m));
    if in_range {
        let (own, cross) = table();
        let idx = |m: i32| (m - PAD_LO) as usize;
        let mut r = 0.0;
        for (i, &a) in notes.iter().enumerate() {
            r += own[idx(a)];
            for &b in &notes[i + 1..] {
                r += cross[idx(a)][idx(b)];
            }
        }
        return r;
    }
    let mut r: f32 = notes.iter().map(|&m| self_roughness(m)).sum();
    for (i, &a) in notes.iter().enumerate() {
        for &b in &notes[i + 1..] {
            r += cross_roughness(a, b);
        }
    }
    r
}

/// A voicing: MIDI notes, lowest first; `0` marks an unused voice.
pub type Voicing = [i32; VOICES];

/// Every voicing worth considering: four notes of the chord inside the pad's
/// range, covering every chord tone, lowest note in the octave above C3, at
/// most two octaves wide, no two voices closer than a whole step. Any tone may
/// be the doubled one, so a common tone can stay put.
fn candidates(chord: Chord) -> Vec<Vec<i32>> {
    let (pcs, n) = chord.pitch_classes();
    let pcs = &pcs[..n];
    let pool: Vec<i32> = (PAD_LO..=PAD_HI)
        .filter(|m| pcs.contains(&(m.rem_euclid(12) as u8)))
        .collect();
    let mut out = Vec::new();
    let k = pool.len();
    for a in 0..k {
        if pool[a] >= PAD_LO + 12 {
            break;
        }
        for b in a + 1..k {
            for c in b + 1..k {
                for d in c + 1..k {
                    let v = [pool[a], pool[b], pool[c], pool[d]];
                    if v[3] - v[0] > 24 || v.windows(2).any(|w| w[1] - w[0] < 2) {
                        continue;
                    }
                    if pcs
                        .iter()
                        .all(|pc| v.iter().any(|m| m.rem_euclid(12) as u8 == *pc))
                    {
                        out.push(v.to_vec());
                    }
                }
            }
        }
    }
    out
}

/// Choose the pad voicing for `chord`, leading from `prev` (all zeros for a
/// fresh start).
pub fn voice(chord: Chord, prev: &Voicing) -> Voicing {
    let had_prev = prev.iter().any(|&m| m > 0);
    let mut best: Option<(f32, Vec<i32>)> = None;
    for cand in candidates(chord) {
        let motion: f32 = if had_prev {
            let mut p: Vec<i32> = prev.iter().copied().filter(|&m| m > 0).collect();
            p.sort_unstable();
            cand.iter()
                .zip(p.iter())
                .map(|(a, b)| (a - b).unsigned_abs() as f32)
                .sum()
        } else {
            // A fresh voicing sits low and close.
            (cand[0] - PAD_LO) as f32 * 0.5
        };
        let score = motion + 6.0 * roughness(&cand);
        if best.as_ref().is_none_or(|(s, _)| score < *s) {
            best = Some((score, cand));
        }
    }
    let mut out = [0; VOICES];
    if let Some((_, v)) = best {
        for (slot, m) in out.iter_mut().zip(v) {
            *slot = m;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::music::{Color, Key};

    #[test]
    fn roughness_peaks_near_a_quarter_critical_band() {
        // Two 440 Hz-region partials: a semitone apart is rough, a fifth
        // apart is smooth, unison is smooth.
        let semitone = pair_roughness(440.0, 1.0, 466.16, 1.0);
        let fifth = pair_roughness(440.0, 1.0, 659.26, 1.0);
        let unison = pair_roughness(440.0, 1.0, 440.0, 1.0);
        assert!(semitone > 4.0 * fifth, "{semitone} vs {fifth}");
        assert!(unison.abs() < 1e-6);
    }

    #[test]
    fn a_major_triad_in_close_position_is_smoother_than_a_cluster() {
        assert!(roughness(&[60, 64, 67, 72]) < roughness(&[60, 61, 62, 63]));
    }

    #[test]
    fn voicings_stay_in_range_and_contain_the_chord() {
        for collection in -6..=6 {
            for rung in 0..5 {
                let key = Key::new(collection, rung);
                let mut prev = [0; VOICES];
                for deg in [0u8, 3, 4, 5, 0] {
                    let chord = Chord::new(key, deg, Color::Triad);
                    let v = voice(chord, &prev);
                    let (pcs, n) = chord.pitch_classes();
                    for &m in &v {
                        assert!((PAD_LO..=PAD_HI).contains(&m), "{m}");
                        assert!(pcs[..n].contains(&(m.rem_euclid(12) as u8)));
                    }
                    for &pc in &pcs[..n] {
                        assert!(
                            v.iter().any(|&m| m.rem_euclid(12) as u8 == pc),
                            "missing a chord tone"
                        );
                    }
                    prev = v;
                }
            }
        }
    }

    #[test]
    fn voice_leading_moves_little() {
        let key = Key::new(0, 1);
        let c = voice(Chord::new(key, 0, Color::Triad), &[0; VOICES]);
        let f = voice(Chord::new(key, 3, Color::Triad), &c);
        let moved: i32 = c.iter().zip(f.iter()).map(|(a, b)| (a - b).abs()).sum();
        assert!(moved <= 8, "C {c:?} to F {f:?} moved {moved} semitones");
    }
}
