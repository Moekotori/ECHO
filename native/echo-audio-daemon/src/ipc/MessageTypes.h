#pragma once

#include <nlohmann/json.hpp>
#include <string>
#include <functional>
#include <memory>
#include <optional>
#include <cstdint>

using json = nlohmann::json;

namespace echo_audio_daemon {

// ── JSON-RPC 2.0 Error Codes ─────────────────────────────────────────────────
// Standard JSON-RPC 2.0 codes + daemon-specific application codes.
// These mirror DaemonErrorCode from ErrorCodes.h but are defined here
// as a separate enum so the IPC layer has zero dependency on common/.
enum class JsonRpcErrorCode : int32_t {
    // Standard JSON-RPC 2.0
    ParseError       = -32700,
    InvalidRequest   = -32600,
    MethodNotFound   = -32601,
    InvalidParams    = -32602,
    InternalError    = -32000,

    // Daemon-specific
    DeviceUnavailable   = -32001,
    DecodeError         = -32002,
    FormatUnsupported   = -32003,
    SeekError           = -32004,
    AsioDriverError     = -32005,
};

// ── JSON-RPC 2.0 Data Types ──────────────────────────────────────────────────

struct JsonRpcRequest {
    std::string method;
    json params;
    std::optional<json> id;   // nullopt = notification (no response expected)
};

struct JsonRpcError {
    int32_t code;
    std::string message;
    json data = nullptr;
};

struct JsonRpcResponse {
    std::optional<json> id;         // matches request id; null for parse errors
    std::optional<json> result;     // present on success
    std::optional<JsonRpcError> error; // present on failure
};

// ── Request Parsing ──────────────────────────────────────────────────────────

// Parse a raw JSON string into a JsonRpcRequest.
// Returns nullopt on parse error (invalid JSON) — caller sends -32700.
// Throws std::runtime_error on invalid request structure (missing method,
// wrong jsonrpc version, etc.) — caller sends -32600.
inline std::optional<JsonRpcRequest> parseRequest(const std::string& line) {
    json parsed;
    try {
        parsed = json::parse(line);
    } catch (const json::parse_error&) {
        return std::nullopt;
    }

    // Must be an object
    if (!parsed.is_object()) {
        throw std::runtime_error("Request must be a JSON object");
    }

    // jsonrpc field must be "2.0"
    auto jrpcIt = parsed.find("jsonrpc");
    if (jrpcIt == parsed.end()) {
        throw std::runtime_error("Missing jsonrpc field: must be \"2.0\"");
    }
    if (!jrpcIt->is_string() || jrpcIt->get<std::string>() != "2.0") {
        throw std::runtime_error("Invalid jsonrpc version: must be \"2.0\"");
    }

    // method field must be present and a string
    auto methodIt = parsed.find("method");
    if (methodIt == parsed.end()) {
        throw std::runtime_error("Missing method field in request");
    }
    if (!methodIt->is_string()) {
        throw std::runtime_error("Request method must be a string");
    }

    JsonRpcRequest req;
    req.method = methodIt->get<std::string>();

    // params (optional)
    auto paramsIt = parsed.find("params");
    if (paramsIt != parsed.end()) {
        req.params = *paramsIt;
    } else {
        req.params = json::object();
    }

    // id (optional; absence means notification)
    auto idIt = parsed.find("id");
    if (idIt != parsed.end()) {
        req.id = *idIt;
    }

    return req;
}

// ── Response Builders ────────────────────────────────────────────────────────

inline json makeResponse(const JsonRpcResponse& resp) {
    json j = {
        {"jsonrpc", "2.0"},
    };

    if (resp.id.has_value()) {
        j["id"] = resp.id.value();
    } else {
        j["id"] = nullptr;
    }

    if (resp.result.has_value() && !resp.error.has_value()) {
        j["result"] = resp.result.value();
    } else if (resp.error.has_value() && !resp.result.has_value()) {
        j["error"] = {
            {"code", resp.error->code},
            {"message", resp.error->message},
        };
        if (resp.error->data != nullptr && !resp.error->data.is_null()) {
            j["error"]["data"] = resp.error->data;
        }
    }

    return j;
}

inline json makeErrorResponse(const std::optional<json>& id,
                              int32_t code,
                              const std::string& message,
                              json data = nullptr) {
    JsonRpcResponse resp;
    resp.id = json(nullptr);
    if (id.has_value()) {
        resp.id = id.value();
    }
    resp.error = JsonRpcError{code, message, data};
    return makeResponse(resp);
}

inline json makeEvent(const std::string& eventName, json params) {
    json j = {
        {"jsonrpc", "2.0"},
        {"method", eventName},
        {"params", std::move(params)},
    };
    return j;
}

// ── Param Extraction Helpers ─────────────────────────────────────────────────

// Extract a required string param; throws if missing or wrong type.
inline std::string getParamString(const json& params, const std::string& key) {
    auto it = params.find(key);
    if (it == params.end() || !it->is_string()) {
        throw std::runtime_error("Missing or invalid required string param: " + key);
    }
    return it->get<std::string>();
}

// Extract a required number param (int); throws if missing or wrong type.
inline int64_t getParamInt(const json& params, const std::string& key) {
    auto it = params.find(key);
    if (it == params.end() || !it->is_number_integer()) {
        throw std::runtime_error("Missing or invalid required integer param: " + key);
    }
    return it->get<int64_t>();
}

// Extract a required number param (double); throws if missing or wrong type.
inline double getParamDouble(const json& params, const std::string& key) {
    auto it = params.find(key);
    if (it == params.end() || !it->is_number()) {
        throw std::runtime_error("Missing or invalid required number param: " + key);
    }
    return it->get<double>();
}

// Extract a required boolean param; throws if missing or wrong type.
inline bool getParamBool(const json& params, const std::string& key) {
    auto it = params.find(key);
    if (it == params.end() || !it->is_boolean()) {
        throw std::runtime_error("Missing or invalid required boolean param: " + key);
    }
    return it->get<bool>();
}

// Extract an optional string param; returns default if missing.
inline std::string getParamStringOpt(const json& params,
                                     const std::string& key,
                                     const std::string& defaultVal = "") {
    auto it = params.find(key);
    if (it != params.end() && it->is_string()) {
        return it->get<std::string>();
    }
    return defaultVal;
}

// Extract an optional number param (double); returns default if missing.
inline double getParamDoubleOpt(const json& params,
                                const std::string& key,
                                double defaultVal = 0.0) {
    auto it = params.find(key);
    if (it != params.end() && it->is_number()) {
        return it->get<double>();
    }
    return defaultVal;
}

// Extract an optional integer param; returns default if missing.
inline int64_t getParamIntOpt(const json& params,
                              const std::string& key,
                              int64_t defaultVal = 0) {
    auto it = params.find(key);
    if (it != params.end() && it->is_number_integer()) {
        return it->get<int64_t>();
    }
    return defaultVal;
}

// Extract an optional boolean param; returns default if missing.
inline bool getParamBoolOpt(const json& params,
                            const std::string& key,
                            bool defaultVal = false) {
    auto it = params.find(key);
    if (it != params.end() && it->is_boolean()) {
        return it->get<bool>();
    }
    return defaultVal;
}

// ── Method Handler Type ──────────────────────────────────────────────────────

using MethodHandler = std::function<json(const json& params)>;

// ── Method Name Constants ────────────────────────────────────────────────────
// All names from the protocol spec Section 3.

// Playback
constexpr std::string_view METHOD_PLAY              = "play";
constexpr std::string_view METHOD_PAUSE             = "pause";
constexpr std::string_view METHOD_RESUME            = "resume";
constexpr std::string_view METHOD_STOP              = "stop";
constexpr std::string_view METHOD_SEEK              = "seek";
constexpr std::string_view METHOD_NEXT              = "next";
constexpr std::string_view METHOD_PREVIOUS          = "previous";
constexpr std::string_view METHOD_SET_VOLUME        = "setVolume";
constexpr std::string_view METHOD_SET_OUTPUT        = "setOutput";

// Device
constexpr std::string_view METHOD_DEVICE_LIST       = "device.list";

// EQ
constexpr std::string_view METHOD_EQ_SET_BAND       = "eq.setBand";
constexpr std::string_view METHOD_EQ_SET_ENABLED    = "eq.setEnabled";
constexpr std::string_view METHOD_EQ_SET_PRESET     = "eq.setPreset";
constexpr std::string_view METHOD_EQ_RESET          = "eq.reset";

// DSP
constexpr std::string_view METHOD_CONVOLUTION_LOAD_IR      = "convolution.loadIr";
constexpr std::string_view METHOD_CONVOLUTION_SET_ENABLED  = "convolution.setEnabled";
constexpr std::string_view METHOD_CHANNEL_BALANCE_SET_STATE = "channelBalance.setState";

// Probe
constexpr std::string_view METHOD_PROBE             = "probe";

// Subscription
constexpr std::string_view METHOD_LEVEL_METER_SUBSCRIBE   = "levelMeter.subscribe";
constexpr std::string_view METHOD_LEVEL_METER_UNSUBSCRIBE = "levelMeter.unsubscribe";

// Automix
constexpr std::string_view METHOD_PREPARE_AUTOMIX  = "prepareAutomix";
constexpr std::string_view METHOD_QUEUE_NEXT       = "queueNext";

// Lifecycle
constexpr std::string_view METHOD_SHUTDOWN          = "shutdown";

// ── Event Name Constants ─────────────────────────────────────────────────────
// All event names from the protocol spec Section 4.

constexpr std::string_view EVENT_POSITION           = "event.position";
constexpr std::string_view EVENT_STATE              = "event.state";
constexpr std::string_view EVENT_TRACK_ENDED        = "event.trackEnded";
constexpr std::string_view EVENT_TRACK_STARTED      = "event.trackStarted";
constexpr std::string_view EVENT_LEVEL_METER        = "event.levelMeter";
constexpr std::string_view EVENT_DEVICE_CHANGED     = "event.deviceChanged";
constexpr std::string_view EVENT_DSP_STATE          = "event.dspState";
constexpr std::string_view EVENT_READY              = "event.ready";

} // namespace echo_audio_daemon
