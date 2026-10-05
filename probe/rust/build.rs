// The C SDK is compiled into the crate by cargo, never by npm: native code
// lives in the engine's build. One implementation for every language, so a
// Rust engine and a C engine cannot disagree about what a valid capture is.
fn main() {
    for file in ["../c/gdprobe.c", "../c/gdprobe_session.c", "../c/gdprobe.h"] {
        println!("cargo:rerun-if-changed={file}");
    }
    let mut build = cc::Build::new();
    build.file("../c/gdprobe.c").flag_if_supported("-std=c99").warnings(true);
    // Live sessions are POSIX sockets; on Windows that file compiles to stubs.
    build.file("../c/gdprobe_session.c");
    build.compile("gdprobe");
}
