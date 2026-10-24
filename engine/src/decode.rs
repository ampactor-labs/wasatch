//! Decoding the piano's samples inside the engine.
//!
//! The samples ship as MP3 and are decoded here, by symphonia (pure Rust),
//! rather than by the browser's `decodeAudioData`: each browser decodes and
//! resamples with its own code, so each would hold slightly different
//! samples, and the piece promises the same bits everywhere. Decoding runs in
//! a worker with its own instance of this module, before the first tap.

use std::io::Cursor;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::{MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;

/// Decode an MP3 to mono 16-bit PCM, keeping at most `max_seconds` and
/// fading the last 0.4 s of what it keeps. Returns the sample rate and the
/// samples.
pub fn decode_mp3(bytes: &[u8], max_seconds: f32) -> Result<(f32, Vec<i16>), String> {
    let mss = MediaSourceStream::new(
        Box::new(Cursor::new(bytes.to_vec())),
        MediaSourceStreamOptions::default(),
    );
    let mut hint = Hint::new();
    hint.with_extension("mp3");
    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|e| e.to_string())?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or("no audio track")?;
    let track_id = track.id;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or("not an audio track")?
        .clone();
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&params, &AudioDecoderOptions::default())
        .map_err(|e| e.to_string())?;

    let mut rate = 0.0f32;
    let mut mono: Vec<f32> = Vec::new();
    let mut interleaved: Vec<f32> = Vec::new();
    let mut max_frames = usize::MAX;
    while let Some(packet) = format.next_packet().map_err(|e| e.to_string())? {
        if packet.track_id != track_id {
            continue;
        }
        let Ok(buf) = decoder.decode(&packet) else {
            continue;
        };
        let spec = buf.spec();
        rate = spec.rate() as f32;
        let channels = spec.channels().count().max(1);
        if max_frames == usize::MAX {
            max_frames = (max_seconds.max(0.1) * rate) as usize;
        }
        interleaved.clear();
        buf.copy_to_vec_interleaved::<f32>(&mut interleaved);
        for frame in interleaved.chunks(channels) {
            mono.push(frame.iter().sum::<f32>() / channels as f32);
        }
        if mono.len() >= max_frames {
            break;
        }
    }
    if mono.is_empty() || rate <= 0.0 {
        return Err("no audio decoded".into());
    }
    mono.truncate(max_frames);
    let fade = ((0.4 * rate) as usize).min(mono.len());
    let n = mono.len();
    for (i, s) in mono[n - fade..].iter_mut().enumerate() {
        *s *= 1.0 - i as f32 / fade as f32;
    }
    let pcm = mono
        .iter()
        .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
        .collect();
    Ok((rate, pcm))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_a_piano_sample() {
        let bytes = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../web/public/samples/piano/C4.mp3"
        ))
        .expect("the C4 sample is in the repo");
        let (rate, pcm) = decode_mp3(&bytes, 7.0).expect("decodes");
        assert_eq!(rate, 44_100.0);
        assert_eq!(pcm.len(), (7.0 * 44_100.0) as usize);
        let peak = pcm.iter().map(|s| s.unsigned_abs()).max().unwrap_or(0);
        assert!(peak > 3000, "peak {peak}");
        assert!(pcm[pcm.len() - 1].unsigned_abs() < 100, "the tail is faded");
    }

    #[test]
    fn garbage_is_an_error_not_a_panic() {
        assert!(decode_mp3(&[0u8; 512], 1.0).is_err());
    }
}
