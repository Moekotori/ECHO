# Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Decoder | libavcodec | Industry standard, format support, in-process, no CLI |
| Normal output | miniaudio | Single-header, MIT, all platforms, no framework |
| HiFi output | Raw platform APIs | Existing code already JUCE-free, reuse as-is |
| DSP | Pure C++ | No external DSP lib, full control |
| IPC | JSON-RPC 2.0 | Readable, debuggable, standard protocol |
| Build | Standard CMake + pkg-config | Portable, Nix-friendly, no network |
| Strategy | New daemon parallel to existing | Safe transition, no regression risk |
| Result type | Result<T,E> template | Simple discriminated union; E defaults to std::string |
| Error codes | DaemonErrorCode scoped enum | JSON-RPC 2.0 standard codes + daemon-specific range (-32001..-32007) |
| Type tests | Standalone test target no FFmpeg link needed | Pure headers — compile-only tests should not drag in build deps |
| DSP filter impl | Pure C++ BiquadFilter + EqProcessor | RBJ Cookbook formulas, Direct Form I, double→float precision |
| Filter types | 8 RBJ types (Peaking, LP, HP, LS, HS, BP, Notch, AP) | Match standard RBJ set; BandPass/AllPass added beyond existing JUCE EqTypes |
| EQ bands | 10-band parametric | ISO 1/3-octave spacing; new daemon not matching 31-band JUCE EQ |
| Device enumeration | DeviceEnumerator with static methods, platform-guarded | No virtual dispatch overhead; platform backends gated by _WIN32 + CMake options |
| Device IDs | FNV-1a hash of ma_device_id (256 B) → hex string | Deterministic, unique, no dependency on non-deterministic padding |
| Device watcher | Threaded with platform-specific run loop | Windows uses IMMNotificationClient COM; Linux polls /proc/asound/cards; no external deps |
| Hotplug detection | Callback-based with std::function | Decouples detection from reaction; callback must not block |
| Watcher thread model | std::thread with atomic<bool> stop flag | Simple, composable, no external thread pool |
| ChannelBalanceProcessor impl | Pure C++ circular delay buffer with linear interpolation | De-JUCE'd from existing JUCE version; no band compensation, no parameter smoothing (kept simple per spec) |
| Limiter envelope design | Track peak signal level (not gain reduction) | Avoids attenuating sub-threshold signals when envelope starts at 0; attack/release on envelope gives natural ballistics |
| Limiter processBlock | In-place modification | Caller responsibility to refill buffer between reuse; follows existing BiquadFilter/EqProcessor convention |
