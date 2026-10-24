//! The Wasatch theme: the range's summits as a melody.
//!
//! The contour came from USGS 3DEP elevation (DESIGN.md Appendix D): 13
//! summits from Ben Lomond to Mount Nebo, mapped onto ten steps of the scale.
//! The rhythm is set by hand and frozen here: a long murmur along the
//! northern Front, the leap to the Cottonwoods, the dotted plateau of Box
//! Elder, Timpanogos and Provo Peak, the dip at Spanish Fork Canyon, and
//! Nebo held to the end of the fourth bar.

use crate::music::Key;

/// The summits, north to south.
pub const SUMMITS: [&str; 13] = [
    "Ben Lomond",
    "Allen Peak",
    "Thurston Peak",
    "Bountiful Peak",
    "Grandview Peak",
    "Twin Peaks",
    "Box Elder Peak",
    "Mount Timpanogos",
    "Provo Peak",
    "Spanish Fork Peak",
    "Santaquin Peak",
    "Bald Mountain",
    "Mount Nebo",
];

/// Scale steps above the tonic, one per summit.
pub const STEPS: [i32; 13] = [1, 1, 2, 0, 0, 8, 6, 8, 6, 2, 5, 4, 9];

/// Onset and length of each note, in beats over four bars of 4/4.
pub const RHYTHM: [(f32, f32); 13] = [
    (0.0, 2.0),
    (2.0, 1.0),
    (3.0, 1.0),
    (4.0, 3.0),
    (7.0, 1.0),
    (8.0, 1.5),
    (9.5, 0.5),
    (10.0, 1.0),
    (11.0, 1.0),
    (12.0, 1.0),
    (13.0, 0.5),
    (13.5, 0.5),
    (14.0, 2.0),
];

/// Chord degrees under the theme's four bars: I | I | V | I. Bar three's
/// notes (steps 8 and 6) are the fifth and third of the dominant in every
/// mode the piece uses; bar four's are the tonic's third, sixth and fifth.
pub const HARMONY: [u8; 4] = [0, 0, 4, 0];

/// Length in beats.
pub const BEATS: f32 = 16.0;

/// One note of the theme.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct ThemeNote {
    /// Onset in beats from the theme's start.
    pub beat: f32,
    /// Length in beats.
    pub beats: f32,
    /// MIDI note.
    pub midi: i32,
    /// Velocity, 0–1: the summits that stand out are played harder.
    pub velocity: f32,
    /// Which summit it is.
    pub summit: usize,
}

/// The theme in `key`, with its tonic in the octave above middle C.
pub fn notes(key: Key) -> [ThemeNote; 13] {
    let tonic = key.tonic_at_or_above(60);
    core::array::from_fn(|i| {
        let step = STEPS[i];
        let (beat, beats) = RHYTHM[i];
        ThemeNote {
            beat,
            beats,
            midi: key.degree_to_midi(step, tonic),
            velocity: 0.55 + 0.04 * step as f32,
            summit: i,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::music::{Chord, Color};

    #[test]
    fn rhythm_fills_four_bars_without_overlap() {
        let mut end = 0.0;
        for &(beat, beats) in &RHYTHM {
            assert!((beat - end).abs() < 1e-6, "gap or overlap at beat {beat}");
            end = beat + beats;
        }
        assert_eq!(end, BEATS);
    }

    #[test]
    fn the_leap_is_more_than_an_octave_in_every_mode() {
        for rung in 0..5 {
            let n = notes(Key::new(0, rung));
            assert!(n[5].midi - n[4].midi > 12, "rung {rung}");
            assert_eq!(
                n[12].midi,
                n.iter().map(|x| x.midi).max().unwrap(),
                "Nebo is the highest note"
            );
        }
    }

    #[test]
    fn bar_three_sits_on_the_dominant() {
        for collection in -6..=6 {
            for rung in 0..5 {
                let key = Key::new(collection, rung);
                let dominant = Chord::new(key, HARMONY[2], Color::Triad);
                let (pcs, n) = dominant.pitch_classes();
                for note in &notes(key)[5..9] {
                    let pc = note.midi.rem_euclid(12) as u8;
                    assert!(pcs[..n].contains(&pc), "{} in {}", note.midi, key.name());
                }
            }
        }
    }
}
