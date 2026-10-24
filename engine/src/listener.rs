//! What the listener plays: notes local to one phone, never part of the
//! shared composition. Play along (tip the phone like a ski) and a run's
//! solo both quantize to the notes in play, so neither can play a wrong note.

use crate::music::Key;

/// The lowest and highest notes the listener's voices play.
pub const LOW: i32 = 55;
/// See [`LOW`].
pub const HIGH: i32 = 86;

/// Every note of `key` in [`LOW`, `HIGH`], ascending; with `chord_tones`,
/// only those whose pitch class is one of `tones`.
pub fn ladder(key: Key, tones: &[u8], chord_tones: bool) -> Vec<i32> {
    let scale = key.scale();
    (LOW..=HIGH)
        .filter(|&m| {
            let pc = m.rem_euclid(12) as u8;
            scale.contains(&pc) && (!chord_tones || tones.is_empty() || tones.contains(&pc))
        })
        .collect()
}

/// The note for a ski's edge: `edge` from −1 (hard on the left edge) to 1
/// (hard right) picks a rung of the ladder; a steady edge plays chord tones,
/// a wobble passing tones.
pub fn edge_note(key: Key, tones: &[u8], edge: f32, steady: bool) -> i32 {
    let rungs = ladder(key, tones, steady);
    if rungs.is_empty() {
        return key.tonic_at_or_above(60);
    }
    let t = ((edge.clamp(-1.0, 1.0) + 1.0) * 0.5 * (rungs.len() - 1) as f32).round() as usize;
    rungs[t.min(rungs.len() - 1)]
}

/// One note of a run's solo, in beats from its start and scale degrees from
/// the tonic near middle C (0 the tonic, 7 an octave up, −2 below).
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct SoloNote {
    /// Onset, beats.
    pub beat: f32,
    /// Scale degree from the tonic at or above MIDI 60.
    pub degree: i32,
    /// Velocity, 0–1.
    pub vel: f32,
    /// Length, beats.
    pub beats: f32,
}

/// A solo degree in `key`, folded by octaves into the listener's range.
pub fn solo_midi(key: Key, degree: i32) -> i32 {
    let mut m = key.degree_to_midi(degree, key.tonic_at_or_above(60));
    while m < LOW {
        m += 12;
    }
    while m > HIGH {
        m -= 12;
    }
    m
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ladder_is_the_key_and_the_chord() {
        let c = Key::new(0, 1);
        let all = ladder(c, &[0, 4, 7], false);
        assert!(
            all.iter()
                .all(|m| c.scale().contains(&(m.rem_euclid(12) as u8)))
        );
        assert_eq!(all.first(), Some(&55));
        let chord = ladder(c, &[0, 4, 7], true);
        assert!(chord.iter().all(|m| [0, 4, 7].contains(&m.rem_euclid(12))));
        assert!(chord.len() < all.len());
    }

    #[test]
    fn edges_climb_and_never_leave_the_key() {
        let d_dorian = Key::new(0, 3);
        let mut last = 0;
        for k in 0..=20 {
            let edge = -1.0 + k as f32 * 0.1;
            let m = edge_note(d_dorian, &[2, 5, 9], edge, false);
            assert!(m >= last, "edge {edge} went down");
            assert!(d_dorian.scale().contains(&(m.rem_euclid(12) as u8)));
            last = m;
        }
        // Hard left on a steady edge: the lowest chord tone in range, A3.
        assert_eq!(edge_note(d_dorian, &[2, 5, 9], -1.0, true), 57);
        assert_eq!(edge_note(d_dorian, &[2, 5, 9], 1.0, true).rem_euclid(12), 2);
    }

    #[test]
    fn solo_degrees_stay_in_range() {
        let g = Key::new(1, 1);
        assert_eq!(solo_midi(g, 0), 67);
        assert_eq!(solo_midi(g, 7), 79);
        for d in -30..30 {
            let m = solo_midi(g, d);
            assert!((LOW..=HIGH).contains(&m));
            assert!(g.scale().contains(&(m.rem_euclid(12) as u8)));
        }
    }
}
