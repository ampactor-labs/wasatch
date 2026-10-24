//! Render the piece offline from the real schedule, for listening and checks.
//!
//! `cargo run --release --example render -- <YYYY-MM-DD> <HH:MM> <seconds> <out.wav>`
//! renders from that local (Mountain) time. Prints loudness, true peak,
//! silence, events and the realtime factor.

use std::fs;
use std::time::Instant;
use wasatch_engine::audio::voices::PianoSample;
use wasatch_engine::compose::Slow;
use wasatch_engine::engine::{DELAY_MS, Engine};
use wasatch_engine::schedule::{Network, RouteKind, ServiceDay, Stop};

const WEB: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../web/public");

fn load_day(engine: &mut Engine, date: &str, key: &str, t0: f64) {
    let v: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(format!("{WEB}/schedule/day-{key}.json")).unwrap(),
    )
    .unwrap();
    let mut rail = Vec::new();
    for trip in v["rail"].as_array().unwrap() {
        let r = trip["r"].as_u64().unwrap() as u32;
        let d = trip["d"].as_u64().unwrap() as u32;
        for (s, t) in trip["s"]
            .as_array()
            .unwrap()
            .iter()
            .zip(trip["t"].as_array().unwrap())
        {
            rail.push((
                t.as_u64().unwrap() as u32,
                r | (d << 8) | ((s.as_u64().unwrap() as u32) << 16),
            ));
        }
    }
    let ski = v["ski"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            (
                s["t"].as_u64().unwrap() as u32,
                s["r"].as_u64().unwrap() as u32,
            )
        })
        .collect();
    let bus: Vec<u16> = v["bus"]["perMinute"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_u64().unwrap() as u16)
        .collect();
    let bus_west: Vec<u16> = v["bus"]["west"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_u64().unwrap() as u16)
        .collect();
    let date_num: u32 = date.replace('-', "").parse().unwrap();
    engine.set_day(ServiceDay {
        date: date_num,
        t0_ms: t0,
        rail,
        ski,
        bus,
        bus_west,
    });
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let date = args.get(1).cloned().unwrap_or_else(|| "2026-10-23".into());
    let time = args.get(2).cloned().unwrap_or_else(|| "17:40".into());
    let seconds: f64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(120.0);
    let out = args
        .get(4)
        .cloned()
        .unwrap_or_else(|| "/tmp/wasatch.wav".into());
    let sr = 48_000.0f32;

    let manifest: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(format!("{WEB}/schedule/manifest.json")).unwrap())
            .unwrap();
    let mut engine = Engine::new(sr);

    // Network.
    let net: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(format!("{WEB}/schedule/network.json")).unwrap())
            .unwrap();
    let routes = net["routes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            match (
                r["kind"].as_str().unwrap(),
                r["name"].as_str().unwrap_or(""),
            ) {
                ("trax", n) if n.contains("Blue") => RouteKind::Trax(0),
                ("trax", n) if n.contains("Red") => RouteKind::Trax(1),
                ("trax", _) => RouteKind::Trax(2),
                ("sline", _) => RouteKind::SLine,
                ("frontrunner", _) => RouteKind::FrontRunner,
                ("ski", n) if n.contains("BRIGHT") || n.contains("SOL") => RouteKind::Ski(1),
                ("ski", _) => RouteKind::Ski(0),
                _ => RouteKind::Other,
            }
        })
        .collect();
    let stops_json = net["stops"].as_array().unwrap();
    let stops = stops_json
        .iter()
        .map(|s| Stop {
            lat: s["lat"].as_f64().unwrap() as f32,
            lon: s["lon"].as_f64().unwrap() as f32,
        })
        .collect();
    let slc_central = stops_json
        .iter()
        .position(|s| {
            s["name"]
                .as_str()
                .unwrap_or("")
                .contains("Salt Lake Central")
        })
        .map(|i| i as u16);
    engine.set_network(Network {
        routes,
        stops,
        slc_central,
    });

    // The days around the date, as the browser loads them.
    let days = manifest["days"].as_object().unwrap();
    let t0s = manifest["t0"].as_object().unwrap();
    let target = t0s[&date].as_f64().expect("date in the manifest");
    for (d, key) in days {
        let t0 = t0s[d].as_f64().unwrap();
        if (t0 - target).abs() <= 1.5 * 86_400_000.0 {
            load_day(&mut engine, d, key.as_str().unwrap(), t0);
        }
    }

    // The skyline and the piano.
    let crest: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../research/skyline/crest_profile.json"
        ))
        .unwrap(),
    )
    .unwrap();
    let elev: Vec<f32> = crest["profile_m"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap() as f32 * 3.28084)
        .collect();
    engine.set_skyline(&elev);
    for (name, midi) in [
        ("A2", 45),
        ("C3", 48),
        ("Ds3", 51),
        ("Fs3", 54),
        ("A3", 57),
        ("C4", 60),
        ("Ds4", 63),
        ("Fs4", 66),
        ("A4", 69),
        ("C5", 72),
        ("Ds5", 75),
        ("Fs5", 78),
        ("A5", 81),
        ("C6", 84),
        ("Ds6", 87),
        ("Fs6", 90),
        ("A6", 93),
        ("C7", 96),
    ] {
        let bytes = fs::read(format!("{WEB}/samples/piano/{name}.mp3")).unwrap();
        let (rate, data) = wasatch_engine::decode::decode_mp3(&bytes, 7.0).unwrap();
        engine.add_sample(PianoSample { midi, rate, data });
    }
    engine.set_slow(Slow {
        ground: [0.0; 4],
        ..Slow::default()
    });

    // Start at the given local time on the date: listening time = that time,
    // so the wall clock is 90 s later.
    let t0 = t0s[&date].as_f64().expect("date in the manifest");
    let (h, m) = time.split_once(':').unwrap();
    let local_ms = (h.parse::<f64>().unwrap() * 60.0 + m.parse::<f64>().unwrap()) * 60_000.0;
    engine.set_clock(0.0, t0 + local_ms + DELAY_MS);
    engine.start();

    let frames = (seconds * f64::from(sr)) as usize;
    let mut left = Vec::with_capacity(frames);
    let mut right = Vec::with_capacity(frames);
    let mut events = 0usize;
    let mut kinds = std::collections::BTreeMap::new();
    let started = Instant::now();
    let mut done = 0;
    while done < frames {
        let n = 128.min(frames - done);
        let buf = engine.render(n).to_vec();
        left.extend_from_slice(&buf[..n]);
        right.extend_from_slice(&buf[n..2 * n]);
        let ob = engine.take_outbox();
        if std::env::var("PEEK").is_ok() && done < 48_000 * 30 {
            for l in ob.lines() {
                if !l.contains("\"theme\"") {
                    println!("{l}");
                }
            }
        }
        for line in ob.lines() {
            events += 1;
            let v: serde_json::Value = serde_json::from_str(line).unwrap();
            *kinds
                .entry(v["t"].as_str().unwrap().to_string())
                .or_insert(0) += 1;
        }
        done += n;
    }
    let elapsed = started.elapsed().as_secs_f64();

    let mut meter = sonido_analysis::loudness::LufsMeter::new(sr);
    meter.push_samples(&left, &right);
    let tp = sonido_core::TruePeakDetector::measure(&left)
        .max(sonido_core::TruePeakDetector::measure(&right));
    let mut longest_quiet = 0usize;
    let mut run = 0usize;
    for (l, r) in left.iter().zip(right.iter()) {
        if l.abs().max(r.abs()) < 1e-4 {
            run += 1;
            longest_quiet = longest_quiet.max(run);
        } else {
            run = 0;
        }
    }
    let spec = hound::WavSpec {
        channels: 2,
        sample_rate: sr as u32,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut w = hound::WavWriter::create(&out, spec).unwrap();
    for (l, r) in left.iter().zip(right.iter()) {
        w.write_sample((l.clamp(-1.0, 1.0) * 32767.0) as i16)
            .unwrap();
        w.write_sample((r.clamp(-1.0, 1.0) * 32767.0) as i16)
            .unwrap();
    }
    w.finalize().unwrap();
    println!("{date} {time} for {seconds:.0} s -> {out}");
    println!(
        "integrated {:.1} LUFS, true peak {:.2} dBTP, longest near-silence {:.2} s",
        meter.integrated(),
        20.0 * tp.max(1e-9).log10(),
        longest_quiet as f64 / f64::from(sr)
    );
    println!("{events} events {kinds:?}");
    println!(
        "rendered {:.0}x realtime ({:.1}% of a core)",
        seconds / elapsed,
        100.0 * elapsed / seconds
    );
}
