//! Wasatch Symphony's engine: the Salt Lake valley's data in, music out.
//!
//! One crate, compiled once to WebAssembly: the browser runs it inside a
//! single AudioWorklet, and CI and Rewind run the same binary offline. See
//! DESIGN.md for what the music does and why.

pub mod audio;
pub mod compose;
pub mod decode;
pub mod engine;
pub mod ffi;
pub mod music;
pub mod plan;
pub mod schedule;
pub mod sky;
pub mod theme;
pub mod voicing;
