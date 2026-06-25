#include "src/dsp/ConvolutionProcessor.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <string>
#include <vector>

// ==========================================================================
//  Minimal test framework (self-contained, no external deps)
// ==========================================================================

static int g_testCount = 0;
static int g_passCount = 0;
static int g_failCount = 0;
static const char* g_currentSuite = "";

#define TEST(suite, name)                                                     \
    do {                                                                      \
        g_currentSuite = #suite;                                              \
        ++g_testCount;                                                        \
        struct TestHelper_##suite##_##name {                                  \
            TestHelper_##suite##_##name() {                                   \
                run();                                                        \
            }                                                                 \
            void run();                                                       \
        } testInstance_##suite##_##name;                                      \
    } while (0)

#define CHECK(cond, msg)                                                      \
    do {                                                                      \
        if (!(cond)) {                                                        \
            std::fprintf(stderr,                                              \
                         "  FAIL [%s] %s:%d: %s\n  %s\n",                     \
                         g_currentSuite, __FILE__, __LINE__, #cond, msg);     \
            ++g_failCount;                                                    \
            return;                                                           \
        }                                                                     \
    } while (0)

#define CHECK_CLOSE(a, b, eps, msg)                                           \
    do {                                                                      \
        const double diff_ =                                                  \
            std::abs(static_cast<double>(a) - static_cast<double>(b));        \
        if (diff_ > static_cast<double>(eps)) {                               \
            std::fprintf(stderr,                                              \
                         "  FAIL [%s] %s:%d: |%g - %g| = %g > %g\n  %s\n",   \
                         g_currentSuite, __FILE__, __LINE__,                   \
                         static_cast<double>(a), static_cast<double>(b),      \
                         diff_, static_cast<double>(eps), msg);               \
            ++g_failCount;                                                    \
            return;                                                           \
        }                                                                     \
    } while (0)

static void finishTest() {
    ++g_passCount;
}

// ==========================================================================
//  Test helpers
// ==========================================================================

namespace {

// Generate a unit impulse IR: 1.0 at sample 0, zeros elsewhere.
std::vector<float> makeImpulseIr(int length) {
    std::vector<float> ir(static_cast<size_t>(length), 0.0f);
    ir[0] = 1.0f;
    return ir;
}

// Generate a delay IR: 1.0 at sample `delay`, zeros elsewhere.
std::vector<float> makeDelayIr(int delay, int length) {
    std::vector<float> ir(static_cast<size_t>(length), 0.0f);
    if (delay < length)
        ir[static_cast<size_t>(delay)] = 1.0f;
    return ir;
}

// Compute expected convolution of two vectors.
std::vector<float> referenceConvolution(const std::vector<float>& a,
                                        const std::vector<float>& b) {
    const int na = static_cast<int>(a.size());
    const int nb = static_cast<int>(b.size());
    const int nc = na + nb - 1;
    std::vector<float> c(static_cast<size_t>(nc), 0.0f);
    for (int i = 0; i < na; ++i)
        for (int j = 0; j < nb; ++j)
            c[static_cast<size_t>(i + j)] += a[static_cast<size_t>(i)] *
                                             b[static_cast<size_t>(j)];
    return c;
}

// Process all samples in one block, returning the interleaved output.
struct TestContext {
    echo_audio_daemon::ConvolutionProcessor proc;
    std::vector<float> output;

    void run(const std::vector<float>& ir,
             const std::vector<float>& input,
             int blockSize,
             int channels) {
        proc.loadIrFromSamples(ir.data(), static_cast<int>(ir.size()), 1);
        proc.prepare(blockSize, channels);
        proc.setEnabled(true);

        const int totalFrames = static_cast<int>(input.size()) / channels;
        output.resize(input.size(), 0.0f);

        int framesDone = 0;
        while (framesDone < totalFrames) {
            const int framesThisBlock = std::min(blockSize, totalFrames - framesDone);
            const int offset = framesDone * channels;
            proc.processBlock(
                input.data() + offset,
                output.data() + offset,
                framesThisBlock,
                channels);
            framesDone += framesThisBlock;
        }
    }
};

// Process block-by-block with partition size awareness.
void processBlocks(echo_audio_daemon::ConvolutionProcessor& proc,
                   const std::vector<float>& input,
                   std::vector<float>& output,
                   int blockSize,
                   int channels) {
    const int totalFrames = static_cast<int>(input.size()) / channels;
    output.resize(input.size(), 0.0f);
    int framesDone = 0;
    while (framesDone < totalFrames) {
        const int framesThisBlock = std::min(blockSize, totalFrames - framesDone);
        const int offset = framesDone * channels;
        proc.processBlock(input.data() + offset,
                          output.data() + offset,
                          framesThisBlock,
                          channels);
        framesDone += framesThisBlock;
    }
}

} // anonymous namespace

// ==========================================================================
//  Tests
// ==========================================================================

// ── Direct convolution tests (IR < 256) ──────────────────────────────────

void testUnitImpulseDirect() {
    // IR = [1.0] → output should equal input
    const int irLen = 1;
    const int blockSize = 64;
    const int channels = 1;
    const int numFrames = 256;

    auto ir = makeImpulseIr(irLen);
    std::vector<float> input(static_cast<size_t>(numFrames), 0.0f);
    for (int i = 0; i < numFrames; ++i)
        input[static_cast<size_t>(i)] = static_cast<float>(i) * 0.01f;

    TestContext ctx;
    ctx.run(ir, input, blockSize, channels);

    for (int i = 0; i < numFrames; ++i) {
        CHECK_CLOSE(ctx.output[static_cast<size_t>(i)],
                    input[static_cast<size_t>(i)], 1.0e-6f,
                    "Unit impulse should pass input through unchanged");
    }
    finishTest();
}

void testDelayIrDirect() {
    // IR with 1.0 at sample 100 → output[n] = input[n-100] for n >= 100
    const int delay = 100;
    const int irLen = delay + 1;
    const int blockSize = 64;
    const int channels = 1;
    const int numFrames = 512;

    auto ir = makeDelayIr(delay, irLen);
    std::vector<float> input(static_cast<size_t>(numFrames), 0.0f);
    for (int i = 0; i < numFrames; ++i)
        input[static_cast<size_t>(i)] = static_cast<float>(i) * 0.01f;

    TestContext ctx;
    ctx.run(ir, input, blockSize, channels);

    // First `delay` samples should be zero
    for (int i = 0; i < delay; ++i) {
        CHECK_CLOSE(ctx.output[static_cast<size_t>(i)], 0.0f, 1.0e-6f,
                    "Delay IR: first samples should be zero");
    }
    // After delay, output should equal delayed input
    for (int i = delay; i < numFrames; ++i) {
        CHECK_CLOSE(ctx.output[static_cast<size_t>(i)],
                    input[static_cast<size_t>(i - delay)], 1.0e-6f,
                    "Delay IR: output should match delayed input");
    }
    finishTest();
}

void testKnownIrDirect() {
    // IR = [0.5, 0.5] with simple input
    const std::vector<float> ir = {0.5f, 0.5f};
    const int blockSize = 64;
    const int channels = 1;
    const int numFrames = 20;

    std::vector<float> input(static_cast<size_t>(numFrames), 0.0f);
    for (int i = 0; i < numFrames; ++i)
        input[static_cast<size_t>(i)] = static_cast<float>(i + 1);

    auto expected = referenceConvolution(ir, input);

    TestContext ctx;
    ctx.run(ir, input, blockSize, channels);

    // Check samples within output buffer bounds; the convolution tail (last
    // irLen-1 samples) extends beyond the input and requires a zero-padded
    // flush block — check only what fits.
    const int validOut = std::min(static_cast<int>(expected.size()),
                                  static_cast<int>(ctx.output.size()));
    for (int i = 0; i < validOut; ++i) {
        CHECK_CLOSE(ctx.output[static_cast<size_t>(i)],
                    expected[static_cast<size_t>(i)], 1.0e-5f,
                    "Known IR: output should match reference convolution");
    }
    finishTest();
}

void testStereoDirect() {
    // IR = [1.0], stereo processing: both channels should match input
    const std::vector<float> ir = {1.0f};
    const int blockSize = 64;
    const int channels = 2;
    const int numFrames = 128;
    const int numSamples = numFrames * channels;

    // Stereo interleaved input: ch0 = ramp, ch1 = ramp*2
    std::vector<float> input(static_cast<size_t>(numSamples), 0.0f);
    for (int i = 0; i < numFrames; ++i) {
        input[static_cast<size_t>(i * channels + 0)] = static_cast<float>(i) * 0.01f;
        input[static_cast<size_t>(i * channels + 1)] = static_cast<float>(i) * 0.02f;
    }

    TestContext ctx;
    ctx.run(ir, input, blockSize, channels);

    for (int i = 0; i < numSamples; ++i) {
        CHECK_CLOSE(ctx.output[static_cast<size_t>(i)],
                    input[static_cast<size_t>(i)], 1.0e-6f,
                    "Stereo unit impulse: output == input for both channels");
    }
    finishTest();
}

// ── Partitioned convolution tests (IR > 1024) ────────────────────────────

void testUnitImpulsePartitioned() {
    // Create an IR slightly longer than partition size to force partitioned mode
    const int irLen = 2000; // > 1024 partition size → partitioned mode
    const int blockSize = 512;
    const int channels = 1;
    const int numFrames = 1024;

    auto ir = makeImpulseIr(irLen);
    std::vector<float> input(static_cast<size_t>(numFrames), 0.0f);
    for (int i = 0; i < numFrames; ++i)
        input[static_cast<size_t>(i)] = static_cast<float>(i) * 0.005f;

    TestContext ctx;
    ctx.run(ir, input, blockSize, channels);

    for (int i = 0; i < numFrames; ++i) {
        CHECK_CLOSE(ctx.output[static_cast<size_t>(i)],
                    input[static_cast<size_t>(i)], 1.0e-4f,
                    "Partitioned: unit impulse should pass input through");
    }
    finishTest();
}

void testDelayIrPartitioned() {
    // IR = [0 ... 0, 1.0 at sample 1500]
    const int delay = 1500;
    const int irLen = delay + 1; // > 1024 → partitioned
    const int blockSize = 512;
    const int channels = 1;
    const int numFrames = 4096;

    auto ir = makeDelayIr(delay, irLen);
    std::vector<float> input(static_cast<size_t>(numFrames), 0.0f);
    for (int i = 0; i < numFrames; ++i)
        input[static_cast<size_t>(i)] = static_cast<float>(i) * 0.005f;

    TestContext ctx;
    ctx.run(ir, input, blockSize, channels);

    // After delay, output should match delayed input
    for (int i = delay; i < numFrames; ++i) {
        CHECK_CLOSE(ctx.output[static_cast<size_t>(i)],
                    input[static_cast<size_t>(i - delay)], 1.0e-4f,
                    "Partitioned delay: output should match delayed input");
    }
    finishTest();
}

void testKnownIrPartitioned() {
    // Use a longer IR to force partitioned mode and verify against reference
    // Generate a random-ish IR of length 2000
    const int irLen = 2000;
    const int blockSize = 512;
    const int channels = 1;
    const int numFrames = 2048;

    std::vector<float> ir(static_cast<size_t>(irLen), 0.0f);
    // Slightly more interesting than impulse: decaying sine
    for (int i = 0; i < irLen; ++i) {
        const double t = static_cast<double>(i) / static_cast<double>(irLen);
        ir[static_cast<size_t>(i)] = static_cast<float>(
            std::sin(t * 20.0) * std::exp(-t * 3.0));
    }

    std::vector<float> input(static_cast<size_t>(numFrames), 0.0f);
    for (int i = 0; i < numFrames; ++i)
        input[static_cast<size_t>(i)] = static_cast<float>(std::sin(
            static_cast<double>(i) * 0.01));

    auto expected = referenceConvolution(ir, input);

    TestContext ctx;
    ctx.run(ir, input, blockSize, channels);

    const int validOut = std::min(static_cast<int>(expected.size()),
                                  static_cast<int>(ctx.output.size()));
    for (int i = 0; i < validOut; ++i) {
        CHECK_CLOSE(ctx.output[static_cast<size_t>(i)],
                    expected[static_cast<size_t>(i)], 1.0e-3f,
                    "Partitioned known IR: output should match reference convolution");
    }
    finishTest();
}

void testPartitionedStereo() {
    // Stereo processing with partitioned convolution
    const int irLen = 2000;
    const int blockSize = 512;
    const int channels = 2;
    const int numFrames = 1024;
    const int numSamples = numFrames * channels;

    auto ir = makeImpulseIr(irLen);
    std::vector<float> input(static_cast<size_t>(numSamples), 0.0f);
    for (int i = 0; i < numFrames; ++i) {
        input[static_cast<size_t>(i * channels + 0)] = static_cast<float>(i) * 0.005f;
        input[static_cast<size_t>(i * channels + 1)] = static_cast<float>(i) * 0.01f;
    }

    TestContext ctx;
    ctx.run(ir, input, blockSize, channels);

    for (int i = 0; i < numSamples; ++i) {
        CHECK_CLOSE(ctx.output[static_cast<size_t>(i)],
                    input[static_cast<size_t>(i)], 1.0e-4f,
                    "Partitioned stereo: output should match input");
    }
    finishTest();
}

// ── Enable / Disable tests ───────────────────────────────────────────────

void testDisableBypass() {
    const std::vector<float> ir = {1.0f};
    const int blockSize = 64;
    const int channels = 1;
    const int numFrames = 128;

    std::vector<float> input(static_cast<size_t>(numFrames), 0.0f);
    for (int i = 0; i < numFrames; ++i)
        input[static_cast<size_t>(i)] = static_cast<float>(i) * 0.01f;

    echo_audio_daemon::ConvolutionProcessor proc;
    proc.loadIrFromSamples(ir.data(), static_cast<int>(ir.size()), 1);
    proc.prepare(blockSize, channels);
    proc.setEnabled(false);

    std::vector<float> output;
    processBlocks(proc, input, output, blockSize, channels);

    for (int i = 0; i < numFrames; ++i) {
        CHECK_CLOSE(output[static_cast<size_t>(i)],
                    input[static_cast<size_t>(i)], 1.0e-6f,
                    "Disabled: output should equal input (bypass)");
    }

    // Now enable and verify convolution works
    proc.setEnabled(true);
    proc.reset();
    processBlocks(proc, input, output, blockSize, channels);

    for (int i = 0; i < numFrames; ++i) {
        CHECK_CLOSE(output[static_cast<size_t>(i)],
                    input[static_cast<size_t>(i)], 1.0e-6f,
                    "Re-enabled: output should equal input (unit impulse)");
    }
    finishTest();
}

void testDisablePartitioned() {
    const int irLen = 2000;
    const int blockSize = 512;
    const int channels = 1;
    const int numFrames = 1024;

    auto ir = makeImpulseIr(irLen);
    std::vector<float> input(static_cast<size_t>(numFrames), 0.0f);
    for (int i = 0; i < numFrames; ++i)
        input[static_cast<size_t>(i)] = static_cast<float>(i) * 0.005f;

    echo_audio_daemon::ConvolutionProcessor proc;
    proc.loadIrFromSamples(ir.data(), static_cast<int>(ir.size()), 1);
    proc.prepare(blockSize, channels);
    proc.setEnabled(false);

    std::vector<float> output;
    processBlocks(proc, input, output, blockSize, channels);

    for (int i = 0; i < numFrames; ++i) {
        CHECK_CLOSE(output[static_cast<size_t>(i)],
                    input[static_cast<size_t>(i)], 1.0e-6f,
                    "Partitioned disabled: output should equal input");
    }

    proc.setEnabled(true);
    proc.reset();
    processBlocks(proc, input, output, blockSize, channels);

    for (int i = 0; i < numFrames; ++i) {
        CHECK_CLOSE(output[static_cast<size_t>(i)],
                    input[static_cast<size_t>(i)], 1.0e-4f,
                    "Partitioned re-enabled: unit impulse passthrough");
    }
    finishTest();
}

// ── Stereo IR loading ────────────────────────────────────────────────────

void testStereoIrLoading() {
    // Load a stereo IR (2 channels of interleaved samples).
    // The processor should average channels to mono.
    const int numFrames = 100;
    const int numCh = 2;
    const int numSamples = numFrames * numCh;

    std::vector<float> stereoIr(static_cast<size_t>(numSamples), 0.0f);
    for (int i = 0; i < numFrames; ++i) {
        stereoIr[static_cast<size_t>(i * numCh + 0)] = 1.0f;      // ch0
        stereoIr[static_cast<size_t>(i * numCh + 1)] = 0.5f;      // ch1
    }

    // loadIrFromSamples should average → IR becomes [0.75, 0.75, ...]
    echo_audio_daemon::ConvolutionProcessor proc;
    proc.loadIrFromSamples(stereoIr.data(), numFrames, numCh);
    CHECK(proc.irLoaded(), "IR should be loaded");
    CHECK(proc.irLength() == numFrames, "IR length should match frame count");

    // Process and verify: IR is [0.75] at all taps → output = 0.75 * input
    // Actually the averaged IR is 0.75 * impulse.
    // Wait: ch0=1.0, ch1=0.5, average = 0.75 for all samples.
    // Let me check: the IR averaging happens per-frame. So frame 0 = (1.0+0.5)/2 = 0.75.
    // All 100 frames are 0.75.
    // That's not a unit impulse. Let me verify differently.

    // Actually, I should make a cleaner test. Let me make the stereo IR have
    // ch0=1.0 at sample 0 and ch1=1.0 at sample 0 (so averaged = 1.0 at sample 0).
    const int numSamples2 = 200 * 2; // 200 frames, stereo
    std::vector<float> stereoIr2(static_cast<size_t>(numSamples2), 0.0f);
    // ch0: [1.0, zeros], ch1: [1.0, zeros]
    stereoIr2[0] = 1.0f; // frame 0, ch0
    stereoIr2[1] = 1.0f; // frame 0, ch1
    // After averaging: [1.0, 0, 0, ...] → unit impulse

    echo_audio_daemon::ConvolutionProcessor proc2;
    proc2.loadIrFromSamples(stereoIr2.data(), 200, 2); // 200 frames, stereo
    CHECK(proc2.irLoaded(), "Stereo IR should be loaded");
    CHECK(proc2.irLength() == 200, "Stereo IR length should be frame count");
    // The averaged mono IR should be [1.0, 0, 0, ...]
    CHECK_CLOSE(proc2.irLength(), 200, 0, "IR length should be 200");

    proc2.prepare(64, 1);
    proc2.setEnabled(true);

    const int testFrames = 128;
    std::vector<float> input(static_cast<size_t>(testFrames), 0.0f);
    for (int i = 0; i < testFrames; ++i)
        input[static_cast<size_t>(i)] = static_cast<float>(i) * 0.01f;

    std::vector<float> output;
    processBlocks(proc2, input, output, 64, 1);

    for (int i = 0; i < testFrames; ++i) {
        CHECK_CLOSE(output[static_cast<size_t>(i)],
                    input[static_cast<size_t>(i)], 1.0e-6f,
                    "Stereo IR averaged to mono impulse should pass through");
    }
    finishTest();
}

// ==========================================================================
//  Main
// ==========================================================================

int main() {
    // ── Direct convolution tests ──
    testUnitImpulseDirect();
    testDelayIrDirect();
    testKnownIrDirect();
    testStereoDirect();

    // ── Partitioned convolution tests ──
    testUnitImpulsePartitioned();
    testDelayIrPartitioned();
    testKnownIrPartitioned();
    testPartitionedStereo();

    // ── Enable/Disable tests ──
    testDisableBypass();
    testDisablePartitioned();

    // ── Stereo IR loading test ──
    testStereoIrLoading();

    // ── Summary ──
    std::fprintf(stdout, "\n=== ConvolutionProcessor Test Summary ===\n");
    std::fprintf(stdout, "  Total: %d  Pass: %d  Fail: %d\n",
                 g_testCount, g_passCount, g_failCount);

    return g_failCount > 0 ? 1 : 0;
}
