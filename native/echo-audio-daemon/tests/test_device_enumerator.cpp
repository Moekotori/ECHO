// ── Device Enumerator Tests ────────────────────────────────────────────────
// Verifies that DeviceEnumerator returns well-formed device lists across all
// backends without crashing or producing invalid entries.
//
// Build target: echo-daemon-device-enumerator-tests

#include <cassert>
#include <iostream>
#include <string>

#include "src/device/DeviceEnumerator.h"

namespace ead = echo_audio_daemon;

// ── Helpers ─────────────────────────────────────────────────────────────────
#define CHECK(expr)                                                       \
    do {                                                                   \
        if (!(expr)) {                                                     \
            std::cerr << "FAIL [" << __FILE__ << ":" << __LINE__ << "] "  \
                      << #expr << "\n";                                    \
            return 1;                                                      \
        }                                                                  \
    } while (false)

// ── Test: enumerateShared ──────────────────────────────────────────────────
// Must not crash; list length must be >= 0 (empty is valid in CI / headless).
static int test_enumerate_shared() {
    std::cout << "  test_enumerate_shared...\n";

    auto devices = ead::DeviceEnumerator::enumerateShared();
    CHECK(devices.size() >= 0);  // always true, but confirms no crash

    for (const auto& d : devices) {
        CHECK(!d.id.empty());
        CHECK(!d.name.empty());
        CHECK(d.outputMode == ead::OutputMode::Shared);
    }

    std::cout << "    " << devices.size() << " device(s) found.\n";
    return 0;
}

// ── Test: enumerateExclusive ───────────────────────────────────────────────
// Must not crash; on non-Windows / WASAPI-disabled builds this returns empty.
static int test_enumerate_exclusive() {
    std::cout << "  test_enumerate_exclusive...\n";

    auto devices = ead::DeviceEnumerator::enumerateExclusive();
    CHECK(devices.size() >= 0);

    for (const auto& d : devices) {
        CHECK(d.outputMode == ead::OutputMode::Exclusive);
    }

    std::cout << "    " << devices.size() << " device(s) found.\n";
    return 0;
}

// ── Test: enumerateAsio ────────────────────────────────────────────────────
// Must not crash; on non-Windows / non-ASIO builds this returns empty.
static int test_enumerate_asio() {
    std::cout << "  test_enumerate_asio...\n";

    auto devices = ead::DeviceEnumerator::enumerateAsio();
    CHECK(devices.size() >= 0);

    for (const auto& d : devices) {
        CHECK(d.outputMode == ead::OutputMode::Asio);
    }

    std::cout << "    " << devices.size() << " device(s) found.\n";
    return 0;
}

// ── Test: enumerateAll ─────────────────────────────────────────────────────
// Verify every entry has a non-empty id and name (the only invariant that
// must hold regardless of backend availability).
static int test_enumerate_all() {
    std::cout << "  test_enumerate_all...\n";

    auto devices = ead::DeviceEnumerator::enumerateAll();
    CHECK(devices.size() >= 0);

    int idx = 0;
    for (const auto& d : devices) {
        if (d.id.empty()) {
            std::cerr << "  [" << idx << "] empty id (name=\"" << d.name
                      << "\")\n";
            return 1;
        }
        if (d.name.empty()) {
            std::cerr << "  [" << idx << "] empty name (id=\"" << d.id
                      << "\")\n";
            return 1;
        }
        ++idx;
    }

    std::cout << "    " << devices.size() << " device(s) found.\n";
    return 0;
}

// ── Test: getDefaultShared ─────────────────────────────────────────────────
// The returned device should have isDefault == true if any device exists.
// In headless environments the default may be empty — that is acceptable.
static int test_get_default() {
    std::cout << "  test_get_default...\n";

    auto dev = ead::DeviceEnumerator::getDefaultShared();

    if (dev.id.empty()) {
        std::cout << "    No default device (expected in CI / headless).\n";
        return 0;  // not a failure
    }

    CHECK(!dev.name.empty());
    CHECK(dev.isDefault);
    CHECK(dev.outputMode == ead::OutputMode::Shared);

    std::cout << "    Default: \"" << dev.name << "\" (" << dev.id << ")\n";
    return 0;
}

// ── Test: findById ─────────────────────────────────────────────────────────
// Enumerate all devices, pick the first, look it up by id.
static int test_find_by_id() {
    std::cout << "  test_find_by_id...\n";

    auto all = ead::DeviceEnumerator::enumerateAll();
    if (all.empty()) {
        std::cout << "    No devices — skipping lookup test.\n";
        return 0;
    }

    const auto& first = all[0];
    auto found = ead::DeviceEnumerator::findById(first.id);
    CHECK(!found.id.empty());
    CHECK(found.id == first.id);
    CHECK(found.name == first.name);

    std::cout << "    Found: \"" << found.name << "\"\n";
    return 0;
}

// ── Test: findById with unknown id returns empty ────────────────────────────
static int test_find_by_id_unknown() {
    std::cout << "  test_find_by_id_unknown...\n";

    auto dev = ead::DeviceEnumerator::findById("nonexistent_device_id_12345");
    CHECK(dev.id.empty());
    CHECK(dev.name.empty());

    std::cout << "    Correctly returned empty DeviceInfo.\n";
    return 0;
}

// ── Main ────────────────────────────────────────────────────────────────────
int main() {
    std::cout << "=== echo-daemon-device-enumerator tests ===\n";

    int failures = 0;
    failures += test_enumerate_shared();
    failures += test_enumerate_exclusive();
    failures += test_enumerate_asio();
    failures += test_enumerate_all();
    failures += test_get_default();
    failures += test_find_by_id();
    failures += test_find_by_id_unknown();

    if (failures == 0) {
        std::cout << "All tests passed.\n";
        return 0;
    }
    std::cerr << failures << " test(s) failed.\n";
    return 1;
}
