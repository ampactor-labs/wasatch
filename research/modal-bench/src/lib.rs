#![no_std]
// Bank of 2-pole resonators (modal synthesis), SoA layout, f32.
// y[n] = b0*x[n] + a1*y[n-1] - a2*y[n-2]
const MAX: usize = 8192;
static mut A1: [f32; MAX] = [0.0; MAX];
static mut A2: [f32; MAX] = [0.0; MAX];
static mut B0: [f32; MAX] = [0.0; MAX];
static mut Y1: [f32; MAX] = [0.0; MAX];
static mut Y2: [f32; MAX] = [0.0; MAX];
static mut N: usize = 0;
static mut OUT: [f32; 128] = [0.0; 128];

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! { loop {} }

#[no_mangle]
pub extern "C" fn init(n: usize) {
    unsafe {
        N = if n > MAX { MAX } else { n };
        let mut i = 0;
        while i < N {
            // poles near unit circle, frequencies spread; values precomputed crudely (no libm needed)
            let r = 0.9995f32 - (i % 50) as f32 * 0.000005;
            let c = 0.999f32 - (i % 50) as f32 * 0.0015; // cos(w)
            A1[i] = 2.0 * r * c;
            A2[i] = r * r;
            B0[i] = 0.01;
            Y1[i] = 0.0;
            Y2[i] = 0.0;
            i += 1;
        }
    }
}

#[no_mangle]
pub extern "C" fn process(blocks: usize) -> f32 {
    let mut acc = 0.0f32;
    unsafe {
        let n = N;
        let (a1, a2, b0, y1, y2, out) = (
            &*core::ptr::addr_of!(A1), &*core::ptr::addr_of!(A2), &*core::ptr::addr_of!(B0),
            &mut *core::ptr::addr_of_mut!(Y1), &mut *core::ptr::addr_of_mut!(Y2), &mut *core::ptr::addr_of_mut!(OUT));
        for b in 0..blocks {
            for s in out.iter_mut() { *s = 0.0; }
            // impulse excitation at start of each 375th block
            let x0 = if b % 375 == 0 { 1.0f32 } else { 0.0 };
            for f in 0..128 {
                let x = if f == 0 { x0 } else { 0.0 };
                let mut sum = 0.0f32;
                for i in 0..n {
                    let y = b0[i] * x + a1[i] * y1[i] - a2[i] * y2[i];
                    y2[i] = y1[i];
                    y1[i] = y;
                    sum += y;
                }
                out[f] = sum;
            }
            acc += out[64];
        }
    }
    acc
}

#[cfg(target_feature = "simd128")]
#[no_mangle]
pub extern "C" fn process_simd(blocks: usize) -> f32 {
    use core::arch::wasm32::*;
    let mut acc = 0.0f32;
    unsafe {
        let n4 = N / 4;
        let a1 = core::ptr::addr_of!(A1) as *const v128;
        let a2 = core::ptr::addr_of!(A2) as *const v128;
        let b0 = core::ptr::addr_of!(B0) as *const v128;
        let y1 = core::ptr::addr_of_mut!(Y1) as *mut v128;
        let y2 = core::ptr::addr_of_mut!(Y2) as *mut v128;
        let out = &mut *core::ptr::addr_of_mut!(OUT);
        for b in 0..blocks {
            let x0 = if b % 375 == 0 { 1.0f32 } else { 0.0 };
            for f in 0..128 {
                let x = f32x4_splat(if f == 0 { x0 } else { 0.0 });
                let mut vsum = f32x4_splat(0.0);
                for i in 0..n4 {
                    let p1 = v128_load(y1.add(i));
                    let p2 = v128_load(y2.add(i));
                    let y = f32x4_sub(f32x4_add(f32x4_mul(v128_load(b0.add(i)), x), f32x4_mul(v128_load(a1.add(i)), p1)), f32x4_mul(v128_load(a2.add(i)), p2));
                    v128_store(y2.add(i), p1);
                    v128_store(y1.add(i), y);
                    vsum = f32x4_add(vsum, y);
                }
                out[f] = f32x4_extract_lane::<0>(vsum) + f32x4_extract_lane::<1>(vsum) + f32x4_extract_lane::<2>(vsum) + f32x4_extract_lane::<3>(vsum);
            }
            acc += out[64];
        }
    }
    acc
}
