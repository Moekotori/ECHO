#pragma once

#include <cstdint>
#include <type_traits>

namespace echo_audio_daemon {

// ── Daemon Error Codes ──────────────────────────────────────────────────────
// Aligned with JSON-RPC 2.0 specification (section 5.1) for standard error
// codes, extended with daemon-specific codes in the -32000..-32099 range.
//
// JSON-RPC 2.0 reserved ranges:
//   -32700 .. -32000  (standard + server error)
//   -32000 .. -32099  (server-allocated, used by this daemon)
//   0..               (success; not an error code)
enum class DaemonErrorCode : int32_t {
    // ── JSON-RPC 2.0 Standard Codes ────────────────────────────────────
    ParseError      = -32700,  // Invalid JSON in request
    InvalidRequest  = -32600,  // JSON is valid but not a valid Request object
    MethodNotFound  = -32601,  // Method does not exist / is not available
    InvalidParams   = -32602,  // Method parameters are invalid
    InternalError   = -32000,  // Internal JSON-RPC error (generic)

    // ── Daemon-Specific Codes (-32001 .. -32099) ───────────────────────
    DeviceUnavailable   = -32001,  // Requested device not found or not ready
    DecodeError         = -32002,  // Audio decode failure (e.g. corrupt file)
    FormatUnsupported   = -32003,  // Codec/format not supported by decoder
    SeekError           = -32004,  // Seek operation failed
    AsioDriverError     = -32005,  // ASIO driver failure (init, open, or stream)
    InvalidFilePath     = -32006,  // File path is invalid, empty, or malformed
    DeviceInUse         = -32007,  // Device already opened by another session
};

// ── Utility ─────────────────────────────────────────────────────────────────
// Returns true if the code falls in the daemon-specific range.
inline constexpr bool isDaemonError(DaemonErrorCode code) noexcept {
    using Int = std::underlying_type_t<DaemonErrorCode>;
    const auto v = static_cast<Int>(code);
    return v >= -32099 && v <= -32001;
}

// Returns a human-readable label for the error code.
inline constexpr const char* errorCodeLabel(DaemonErrorCode code) noexcept {
    switch (code) {
    case DaemonErrorCode::ParseError:          return "ParseError";
    case DaemonErrorCode::InvalidRequest:      return "InvalidRequest";
    case DaemonErrorCode::MethodNotFound:      return "MethodNotFound";
    case DaemonErrorCode::InvalidParams:       return "InvalidParams";
    case DaemonErrorCode::InternalError:       return "InternalError";
    case DaemonErrorCode::DeviceUnavailable:   return "DeviceUnavailable";
    case DaemonErrorCode::DecodeError:         return "DecodeError";
    case DaemonErrorCode::FormatUnsupported:   return "FormatUnsupported";
    case DaemonErrorCode::SeekError:           return "SeekError";
    case DaemonErrorCode::AsioDriverError:     return "AsioDriverError";
    case DaemonErrorCode::InvalidFilePath:     return "InvalidFilePath";
    case DaemonErrorCode::DeviceInUse:         return "DeviceInUse";
    }
    return "UnknownError";
}

} // namespace echo_audio_daemon
