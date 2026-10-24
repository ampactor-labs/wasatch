//! Pitch, keys and chords: DESIGN.md's harmony space.
//!
//! Positions on the circle of fifths are integers: C = 0, G = 1, D = 2, …,
//! F = −1, B♭ = −2, … A [`Key`] is two numbers. The *notes in play* are a
//! diatonic collection, named by the circle position of its major-scale
//! tonic; *home* is which of its seven notes is the tonic, and its place in
//! the collection's arc is the mode. On a fixed tonic each brighter mode is
//! one step sharpward, so key and mode are one space, and "at most one note
//! changes per boundary" is a distance on the circle.

/// The major scale's intervals above its tonic.
pub const MAJOR: [u8; 7] = [0, 2, 4, 5, 7, 9, 11];

/// Pitch class (0 = C) of a circle-of-fifths position.
pub fn pc_of(pos: i32) -> u8 {
    (pos * 7).rem_euclid(12) as u8
}

/// The five modes the piece uses, brightest first.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
#[repr(u8)]
pub enum Mode {
    /// Home on the collection's flattest note: the brightest.
    Lydian = 0,
    /// The major mode.
    Ionian = 1,
    /// Major with a flat seventh.
    Mixolydian = 2,
    /// Minor with a raised sixth.
    Dorian = 3,
    /// The natural minor: the darkest the piece goes.
    Aeolian = 4,
}

impl Mode {
    /// Every mode, brightest first.
    pub const ALL: [Mode; 5] = [
        Mode::Lydian,
        Mode::Ionian,
        Mode::Mixolydian,
        Mode::Dorian,
        Mode::Aeolian,
    ];

    /// The mode on a brightness rung (0 brightest … 4 darkest), clamped.
    pub fn from_rung(rung: u8) -> Mode {
        Self::ALL[usize::from(rung.min(4))]
    }

    /// Brightness rung: 0 (Lydian) … 4 (Aeolian).
    pub fn rung(self) -> u8 {
        self as u8
    }

    /// The name used in captions.
    pub fn name(self) -> &'static str {
        match self {
            Mode::Lydian => "Lydian",
            Mode::Ionian => "major",
            Mode::Mixolydian => "Mixolydian",
            Mode::Dorian => "Dorian",
            Mode::Aeolian => "minor",
        }
    }

    /// Which degree of the major scale is home in this mode.
    fn major_degree(self) -> usize {
        match self {
            Mode::Ionian => 0,
            Mode::Dorian => 1,
            Mode::Lydian => 3,
            Mode::Mixolydian => 4,
            Mode::Aeolian => 5,
        }
    }

    /// Minor-third modes.
    pub fn is_minor(self) -> bool {
        matches!(self, Mode::Dorian | Mode::Aeolian)
    }
}

/// Letter names in circle-of-fifths order, starting from F.
const LETTERS: [&str; 7] = ["F", "C", "G", "D", "A", "E", "B"];

/// Spelled name of the note at a circle position: positions −1…5 are the
/// naturals F C G D A E B, each seven steps sharpward adds a sharp, each
/// seven flatward adds a flat. Because a key's notes are seven consecutive
/// positions, this spells every key correctly (E♯ in F♯ major, C♭ in G♭).
pub fn note_name(pos: i32) -> String {
    let letter = LETTERS[(pos + 1).rem_euclid(7) as usize];
    let accidentals = (pos + 1).div_euclid(7);
    let mark = match accidentals {
        0 => String::new(),
        n if n > 0 => "♯".repeat(n as usize),
        n => "♭".repeat((-n) as usize),
    };
    format!("{letter}{mark}")
}

/// Notes in play plus home.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub struct Key {
    /// Circle position of the collection's major tonic, in −6…6.
    pub collection: i8,
    /// Brightness rung of home: 0 Lydian … 4 Aeolian.
    pub rung: u8,
}

impl Key {
    /// The home key every day starts in: no sharps or flats.
    pub const HOME_COLLECTION: i8 = 0;

    /// A key, with the collection wrapped into −6…6 and the rung clamped.
    pub fn new(collection: i32, rung: u8) -> Key {
        let mut c = collection;
        while c > 6 {
            c -= 12;
        }
        while c < -6 {
            c += 12;
        }
        Key {
            collection: c as i8,
            rung: rung.min(4),
        }
    }

    /// The mode.
    pub fn mode(self) -> Mode {
        Mode::from_rung(self.rung)
    }

    /// Circle position of the tonic: the collection's flattest note is
    /// Lydian's home, and each darker rung moves home one step sharpward.
    pub fn home_pos(self) -> i32 {
        i32::from(self.collection) - 1 + i32::from(self.rung)
    }

    /// Pitch class of the tonic.
    pub fn tonic_pc(self) -> u8 {
        pc_of(self.home_pos())
    }

    /// The scale's pitch classes from the tonic upward.
    pub fn scale(self) -> [u8; 7] {
        let major_tonic = pc_of(i32::from(self.collection));
        let start = self.mode().major_degree();
        let mut out = [0u8; 7];
        for (i, slot) in out.iter_mut().enumerate() {
            *slot = (major_tonic + MAJOR[(start + i) % 7]) % 12;
        }
        out
    }

    /// Circle positions of the scale degrees, from the tonic upward, for
    /// spelling.
    pub fn scale_positions(self) -> [i32; 7] {
        let scale = self.scale();
        let c = i32::from(self.collection);
        let mut out = [0i32; 7];
        for (slot, &pc) in out.iter_mut().zip(scale.iter()) {
            *slot = (c - 1..=c + 5).find(|&p| pc_of(p) == pc).unwrap_or(c);
        }
        out
    }

    /// `true` if the pitch class is one of the notes in play.
    pub fn contains(self, pc: u8) -> bool {
        self.scale().contains(&(pc % 12))
    }

    /// How many notes differ between two keys' collections (0…6): their
    /// distance on the circle of fifths.
    pub fn notes_changed(self, other: Key) -> u8 {
        let d = (i32::from(self.collection) - i32::from(other.collection)).rem_euclid(12);
        d.min(12 - d) as u8
    }

    /// Semitones above the tonic of scale degree `deg` (any integer;
    /// 7 is the octave).
    pub fn degree_semitones(self, deg: i32) -> i32 {
        let scale = self.scale();
        let tonic = i32::from(scale[0]);
        let octave = deg.div_euclid(7);
        let idx = deg.rem_euclid(7) as usize;
        let rel = (i32::from(scale[idx]) - tonic).rem_euclid(12);
        rel + 12 * octave
    }

    /// MIDI note of scale degree `deg`, given the MIDI note of degree 0.
    pub fn degree_to_midi(self, deg: i32, tonic_midi: i32) -> i32 {
        tonic_midi + self.degree_semitones(deg)
    }

    /// The MIDI note of the tonic in the octave starting at `floor_midi`.
    pub fn tonic_at_or_above(self, floor_midi: i32) -> i32 {
        let pc = i32::from(self.tonic_pc());
        floor_midi + (pc - floor_midi).rem_euclid(12)
    }

    /// The name used in captions: "E Dorian", "G major".
    pub fn name(self) -> String {
        format!("{} {}", note_name(self.home_pos()), self.mode().name())
    }

    /// The name of the collection's major key: "D major's notes".
    pub fn collection_name(self) -> String {
        note_name(i32::from(self.collection))
    }

    /// The pitch class that entered the collection moving from `prev`, and
    /// the one it replaced, as spelled names, when exactly one note changed.
    pub fn changed_note(self, prev: Key) -> Option<(String, String)> {
        if self.notes_changed(prev) != 1 {
            return None;
        }
        let new = i32::from(self.collection);
        let old = i32::from(prev.collection);
        // Sharpward, the old flattest note (old − 1) becomes new + 5;
        // flatward, the old sharpest (old + 5) becomes new − 1.
        let (left, entered) = if (new - old).rem_euclid(12) == 1 {
            (old - 1, new + 5)
        } else {
            (old + 5, new - 1)
        };
        Some((note_name(left), note_name(entered)))
    }
}

/// Chord color beyond the plain triad.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum Color {
    /// Root, third, fifth.
    Triad,
    /// Adds the diatonic seventh.
    Seventh,
    /// Adds the ninth.
    Add9,
    /// The second replaces the third: open, unresolved.
    Sus2,
    /// The fourth replaces the third.
    Sus4,
}

/// A diatonic chord: a scale degree of a key, with a color.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub struct Chord {
    /// The key it belongs to.
    pub key: Key,
    /// Scale degree of the root, 0…6.
    pub degree: u8,
    /// Color.
    pub color: Color,
}

impl Chord {
    /// A chord on `degree` of `key`.
    pub fn new(key: Key, degree: u8, color: Color) -> Chord {
        Chord {
            key,
            degree: degree % 7,
            color,
        }
    }

    /// Scale degrees (relative to the key's tonic, may exceed 6) of the
    /// chord's tones, root first.
    pub fn degrees(self) -> ([i32; 4], usize) {
        let d = i32::from(self.degree);
        match self.color {
            Color::Triad => ([d, d + 2, d + 4, 0], 3),
            Color::Seventh => ([d, d + 2, d + 4, d + 6], 4),
            Color::Add9 => ([d, d + 2, d + 4, d + 8], 4),
            Color::Sus2 => ([d, d + 1, d + 4, 0], 3),
            Color::Sus4 => ([d, d + 3, d + 4, 0], 3),
        }
    }

    /// Pitch classes of the chord's tones, root first.
    pub fn pitch_classes(self) -> ([u8; 4], usize) {
        let (degs, n) = self.degrees();
        let scale = self.key.scale();
        let mut out = [0u8; 4];
        for i in 0..n {
            out[i] = scale[degs[i].rem_euclid(7) as usize];
        }
        (out, n)
    }

    /// Root pitch class.
    pub fn root_pc(self) -> u8 {
        self.key.scale()[usize::from(self.degree)]
    }

    /// `true` if the plain triad on this degree is diminished.
    pub fn is_diminished(self) -> bool {
        let scale = self.key.scale();
        let r = scale[usize::from(self.degree)];
        let f = scale[(usize::from(self.degree) + 4) % 7];
        (f + 12 - r) % 12 == 6
    }

    /// `true` if the plain triad on this degree is minor.
    pub fn is_minor(self) -> bool {
        let scale = self.key.scale();
        let r = scale[usize::from(self.degree)];
        let t = scale[(usize::from(self.degree) + 2) % 7];
        (t + 12 - r) % 12 == 3 && !self.is_diminished()
    }

    /// The chord with its third suspended: to the fourth where the fourth
    /// and the fifth above the root are both perfect, else to the second
    /// where it's a major second; a chord without a perfect fifth stays.
    pub fn suspended(self) -> Chord {
        let scale = self.key.scale();
        let d = usize::from(self.degree);
        let above = |k: usize| (scale[(d + k) % 7] + 12 - scale[d]) % 12;
        if above(4) != 7 {
            return self;
        }
        let color = if above(3) == 5 {
            Color::Sus4
        } else if above(1) == 2 {
            Color::Sus2
        } else {
            return self;
        };
        Chord { color, ..self }
    }

    /// The triad's pitch-class set (order-free), for comparing across keys.
    pub fn triad_set(self) -> [u8; 3] {
        let scale = self.key.scale();
        let d = usize::from(self.degree);
        let mut s = [scale[d], scale[(d + 2) % 7], scale[(d + 4) % 7]];
        s.sort_unstable();
        s
    }

    /// Chord symbol for captions and the mappings view: "Em", "A", "Gsus2".
    pub fn symbol(self) -> String {
        let pos = self.key.scale_positions()[usize::from(self.degree)];
        let root = note_name(pos);
        let quality = if self.is_diminished() {
            "dim"
        } else if self.is_minor() {
            "m"
        } else {
            ""
        };
        let color = match self.color {
            Color::Triad => "",
            Color::Seventh => "7",
            Color::Add9 => "add9",
            Color::Sus2 => "sus2",
            Color::Sus4 => "sus4",
        };
        match self.color {
            Color::Sus2 | Color::Sus4 => format!("{root}{color}"),
            _ => format!("{root}{quality}{color}"),
        }
    }
}

/// The curated progressions per mode, as scale degrees (DESIGN.md
/// "Harmony"). Every chord is diatonic by construction.
pub fn progressions(mode: Mode) -> &'static [&'static [u8]] {
    match mode {
        Mode::Ionian => &[&[0, 4, 5, 3], &[5, 3, 0, 4], &[0, 3, 5, 4], &[1, 4, 0, 0]],
        Mode::Lydian => &[&[0, 1, 0, 6], &[0, 1, 4, 0]],
        Mode::Mixolydian => &[&[0, 6, 3, 0], &[0, 4, 6, 3]],
        Mode::Dorian => &[&[0, 3], &[0, 2, 6, 3]],
        Mode::Aeolian => &[&[0, 5, 2, 6], &[0, 3, 6, 2]],
    }
}

/// The chord a phrase approaches its cadence from: V in the bright modes,
/// ♭VII in the rest.
pub fn approach_degree(mode: Mode) -> u8 {
    match mode {
        Mode::Lydian | Mode::Ionian => 4,
        Mode::Mixolydian | Mode::Dorian | Mode::Aeolian => 6,
    }
}

/// The degree whose diatonic seventh is a dominant seventh that leads home:
/// V in Ionian, II in Lydian, IV in Dorian, ♭VII in Aeolian. Mixolydian's
/// only dominant seventh is on home itself: none.
pub fn dominant_degree(mode: Mode) -> Option<u8> {
    match mode {
        Mode::Ionian => Some(4),
        Mode::Lydian => Some(1),
        Mode::Dorian => Some(3),
        Mode::Aeolian => Some(6),
        Mode::Mixolydian => None,
    }
}

/// The lake's substitute for home: vi in Ionian, Lydian and Mixolydian, ♭III
/// in Dorian, ♭VI in Aeolian.
pub fn deceptive_degree(mode: Mode) -> u8 {
    match mode {
        Mode::Lydian | Mode::Ionian | Mode::Mixolydian => 5,
        Mode::Dorian => 2,
        Mode::Aeolian => 5,
    }
}

/// A chord in `from` that `to` shares, chosen to lead into `to`: its
/// dominant if both keys have it, then its subdominant, its submediant, its
/// supertonic, its tonic, then any shared non-diminished triad. Returned as a
/// degree of `from`.
pub fn pivot(from: Key, to: Key) -> Option<u8> {
    let preferred = [4u8, 3, 5, 1, 0, 2, 6];
    for &deg_to in &preferred {
        let target = Chord::new(to, deg_to, Color::Triad);
        if target.is_diminished() {
            continue;
        }
        let set = target.triad_set();
        for deg_from in 0..7u8 {
            let c = Chord::new(from, deg_from, Color::Triad);
            if !c.is_diminished() && c.triad_set() == set {
                return Some(deg_from);
            }
        }
    }
    None
}

/// MIDI note to frequency, A4 = 440 Hz, equal temperament.
pub fn midi_hz(midi: f32) -> f32 {
    440.0 * libm::exp2f((midi - 69.0) / 12.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(scale: [u8; 7]) -> Vec<u8> {
        let mut v = scale.to_vec();
        v.sort_unstable();
        v
    }

    fn major_set(pos: i32) -> Vec<u8> {
        let t = pc_of(pos);
        let mut v: Vec<u8> = MAJOR.iter().map(|&i| (t + i) % 12).collect();
        v.sort_unstable();
        v
    }

    #[test]
    fn the_ladder_on_c_is_the_circle_of_fifths() {
        // C Lydian = G major's notes, C Ionian = C's, C Mixolydian = F's,
        // C Dorian = B♭'s, C Aeolian = E♭'s.
        let cases = [(1, 0u8), (0, 1), (-1, 2), (-2, 3), (-3, 4)];
        for (collection, rung) in cases {
            let k = Key::new(collection, rung);
            assert_eq!(k.tonic_pc(), 0, "{collection} {rung}");
            assert_eq!(set(k.scale()), major_set(collection));
        }
    }

    #[test]
    fn homes_inside_c_major() {
        let names: Vec<String> = (0..5).map(|r| Key::new(0, r).name()).collect();
        assert_eq!(
            names,
            ["F Lydian", "C major", "G Mixolydian", "D Dorian", "A minor"]
        );
        for r in 0..5 {
            assert_eq!(set(Key::new(0, r).scale()), major_set(0));
        }
    }

    #[test]
    fn spelling_handles_the_far_keys() {
        assert_eq!(note_name(6), "F♯");
        assert_eq!(note_name(11), "E♯");
        assert_eq!(note_name(-6), "G♭");
        assert_eq!(note_name(-7), "C♭");
        assert_eq!(note_name(-2), "B♭");
        let fsharp: Vec<String> = Key::new(6, 1)
            .scale_positions()
            .iter()
            .map(|&p| note_name(p))
            .collect();
        assert_eq!(fsharp, ["F♯", "G♯", "A♯", "B", "C♯", "D♯", "E♯"]);
        assert_eq!(Key::new(-6, 1).name(), "G♭ major");
        assert_eq!(Key::new(7, 1).collection, -5, "C♯ major wraps to D♭");
    }

    #[test]
    fn every_bank_chord_is_diatonic_and_none_diminished() {
        for &mode in &Mode::ALL {
            for collection in -6..=6 {
                let key = Key::new(collection, mode.rung());
                for prog in progressions(mode) {
                    for &deg in prog.iter() {
                        let c = Chord::new(key, deg, Color::Triad);
                        let (pcs, n) = c.pitch_classes();
                        assert!(pcs[..n].iter().all(|&pc| key.contains(pc)));
                        assert!(!c.is_diminished(), "{} in {}", c.symbol(), key.name());
                    }
                }
                for deg in [approach_degree(mode), deceptive_degree(mode)] {
                    assert!(!Chord::new(key, deg, Color::Triad).is_diminished());
                }
            }
        }
    }

    #[test]
    fn deceptive_chords_match_the_design() {
        // On C: Ionian vi = Am, Dorian ♭III = E♭, Aeolian ♭VI = A♭.
        let c_ionian = Key::new(0, 1);
        assert_eq!(
            Chord::new(c_ionian, deceptive_degree(Mode::Ionian), Color::Triad).symbol(),
            "Am"
        );
        let c_dorian = Key::new(-2, 3);
        assert_eq!(
            Chord::new(c_dorian, deceptive_degree(Mode::Dorian), Color::Triad).symbol(),
            "E♭"
        );
        let c_aeolian = Key::new(-3, 4);
        assert_eq!(
            Chord::new(c_aeolian, deceptive_degree(Mode::Aeolian), Color::Triad).symbol(),
            "A♭"
        );
    }

    #[test]
    fn appendix_c_e_dorian_to_b_dorian() {
        let e_dorian = Key::new(2, 3);
        let b_dorian = Key::new(3, 3);
        assert_eq!(e_dorian.name(), "E Dorian");
        assert_eq!(b_dorian.name(), "B Dorian");
        assert_eq!(e_dorian.notes_changed(b_dorian), 1);
        assert_eq!(
            b_dorian.changed_note(e_dorian),
            Some(("G".into(), "G♯".into()))
        );
        // ♭VII → i is D → Em; ♭III is G.
        assert_eq!(Chord::new(e_dorian, 6, Color::Triad).symbol(), "D");
        assert_eq!(Chord::new(e_dorian, 2, Color::Triad).symbol(), "G");
        assert_eq!(Chord::new(e_dorian, 2, Color::Sus2).symbol(), "Gsus2");
        // The pivot: a chord both keys share. B minor (v of E Dorian, i of B
        // Dorian) is one of the four; the rule prefers B Dorian's own V (F♯m),
        // which is also shared.
        let p = pivot(e_dorian, b_dorian).expect("adjacent keys share chords");
        let sym = Chord::new(e_dorian, p, Color::Triad).symbol();
        assert!(["F♯m", "Bm", "A", "D"].contains(&sym.as_str()), "{sym}");
    }

    #[test]
    fn adjacent_collections_share_four_triads() {
        for c in -6..=6 {
            let a = Key::new(c, 1);
            let b = Key::new(c + 1, 1);
            let shared = (0..7u8)
                .filter(|&d| {
                    let ca = Chord::new(a, d, Color::Triad);
                    !ca.is_diminished()
                        && (0..7u8).any(|e| {
                            let cb = Chord::new(b, e, Color::Triad);
                            !cb.is_diminished() && cb.triad_set() == ca.triad_set()
                        })
                })
                .count();
            assert_eq!(shared, 4, "collection {c}");
        }
    }

    #[test]
    fn degree_semitones_wrap_octaves() {
        let k = Key::new(0, 1); // C major
        assert_eq!(k.degree_semitones(0), 0);
        assert_eq!(k.degree_semitones(2), 4);
        assert_eq!(k.degree_semitones(7), 12);
        assert_eq!(k.degree_semitones(9), 16);
        assert_eq!(k.degree_semitones(-1), -1);
        let e_dorian = Key::new(2, 3);
        assert_eq!(e_dorian.degree_semitones(2), 3, "a minor third in Dorian");
        assert_eq!(e_dorian.tonic_at_or_above(60), 64);
    }
}
