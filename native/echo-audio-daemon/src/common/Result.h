#pragma once

#include <stdexcept>
#include <string>
#include <type_traits>
#include <variant>

namespace echo_audio_daemon {

// ── Result<T, E> ────────────────────────────────────────────────────────────
// Simple discriminated union for fallible operations.  Idiomatic use:
//
//   Result<int> parsePort(const std::string& s) {
//       try { return std::stoi(s); }
//       catch (...) { return std::string("invalid port"); }
//   }
//
//   auto r = parsePort("8080");
//   if (r.isOk()) use(r.unwrap());
//
// The error type defaults to std::string for human-readable messages but can
// be any type (e.g. DaemonErrorCode).
template <typename T, typename E = std::string>
class Result {
    static_assert(!std::is_same_v<T, E>,
                  "Result<T,E> requires distinct types for ok and error");

    std::variant<T, E> value_;

public:
    // ── Construction ────────────────────────────────────────────────────
    Result(T&& ok) noexcept(std::is_nothrow_move_constructible_v<T>)
        : value_(std::move(ok)) {}

    Result(const T& ok) noexcept(std::is_nothrow_copy_constructible_v<T>)
        : value_(ok) {}

    Result(E&& err) noexcept(std::is_nothrow_move_constructible_v<E>)
        : value_(std::move(err)) {}

    Result(const E& err) noexcept(std::is_nothrow_copy_constructible_v<E>)
        : value_(err) {}

    // ── Query ───────────────────────────────────────────────────────────
    bool isOk()    const noexcept { return std::holds_alternative<T>(value_); }
    bool isError() const noexcept { return std::holds_alternative<E>(value_); }

    // ── Accessors ───────────────────────────────────────────────────────
    // Returns the ok value.  Throws if the result is an error.
    T&       unwrap() & {
        if (!isOk()) [[unlikely]] {
            throw std::runtime_error("Result::unwrap() called on error: " +
                                     errorString());
        }
        return std::get<T>(value_);
    }

    const T& unwrap() const& {
        if (!isOk()) [[unlikely]] {
            throw std::runtime_error("Result::unwrap() called on error: " +
                                     errorString());
        }
        return std::get<T>(value_);
    }

    T&& unwrap() && {
        if (!isOk()) [[unlikely]] {
            throw std::runtime_error("Result::unwrap() called on error: " +
                                     errorString());
        }
        return std::move(std::get<T>(value_));
    }

    // Returns the error value.  Undefined behavior if isOk() is true.
    const E& error() const& noexcept { return std::get<E>(value_); }
    E&&      error() &&      noexcept { return std::move(std::get<E>(value_)); }

    // Returns the ok value or a fallback.
    template <typename U>
    T valueOr(U&& fallback) const& {
        return isOk() ? std::get<T>(value_) : static_cast<T>(std::forward<U>(fallback));
    }

private:
    std::string errorString() const {
        if constexpr (std::is_same_v<E, std::string>) {
            return std::get<E>(value_);
        } else if constexpr (std::is_enum_v<E>) {
            return std::to_string(static_cast<int>(std::get<E>(value_)));
        } else if constexpr (std::is_arithmetic_v<E>) {
            return std::to_string(static_cast<int>(std::get<E>(value_)));
        } else {
            return "(non-string error)";
        }
    }
};

} // namespace echo_audio_daemon
