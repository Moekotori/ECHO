#pragma once

namespace echo_audio_daemon {

// Run the daemon in null-output mode (testing without real audio hardware).
// Creates a JsonRpcServer with NullBackend, registers all test handlers,
// prints status to stderr, and starts the server (blocks until shutdown).
int runNullOutputMode();

} // namespace echo_audio_daemon
