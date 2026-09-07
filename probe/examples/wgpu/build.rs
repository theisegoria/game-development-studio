// The C probe SDK is compiled into this example by cargo, not by npm. That is
// the rule: native code lives in the engine's build, never in the package.
fn main() {
    println!("cargo:rerun-if-changed=../../c/gdprobe.c");
    println!("cargo:rerun-if-changed=../../c/gdprobe.h");
    cc::Build::new()
        .file("../../c/gdprobe.c")
        .flag_if_supported("-std=c99")
        .warnings(true)
        .compile("gdprobe");
}
