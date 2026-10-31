#pragma once

#include "EqTypes.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace echo
{
struct BiquadCoefficients
{
    float b0 = 1.0f;
    float b1 = 0.0f;
    float b2 = 0.0f;
    float a1 = 0.0f;
    float a2 = 0.0f;
};

struct BiquadState
{
    float x1 = 0.0f;
    float x2 = 0.0f;
    float y1 = 0.0f;
    float y2 = 0.0f;

    void reset()
    {
        x1 = 0.0f;
        x2 = 0.0f;
        y1 = 0.0f;
        y2 = 0.0f;
    }

    float process(float input, const BiquadCoefficients& coefficients)
    {
        const float output = coefficients.b0 * input
            + coefficients.b1 * x1
            + coefficients.b2 * x2
            - coefficients.a1 * y1
            - coefficients.a2 * y2;

        x2 = x1;
        x1 = input;
        y2 = y1;
        y1 = std::isfinite(output) ? output : 0.0f;

        return y1;
    }
};

inline BiquadCoefficients makePeakingCoefficients(
    double sampleRate,
    float frequencyHz,
    float gainDb,
    float q)
{
    if (sampleRate <= 0.0 || std::abs(gainDb) < 0.0001f)
        return {};

    constexpr double pi = 3.14159265358979323846;
    const double safeFrequency = std::clamp<double>(frequencyHz, 10.0, sampleRate * 0.45);
    const double safeQ = std::max(0.1, static_cast<double>(q));
    const double a = std::pow(10.0, static_cast<double>(gainDb) / 40.0);
    const double omega = 2.0 * pi * safeFrequency / sampleRate;
    const double sinOmega = std::sin(omega);
    const double cosOmega = std::cos(omega);
    const double alpha = sinOmega / (2.0 * safeQ);

    const double b0 = 1.0 + alpha * a;
    const double b1 = -2.0 * cosOmega;
    const double b2 = 1.0 - alpha * a;
    const double a0 = 1.0 + alpha / a;
    const double a1 = -2.0 * cosOmega;
    const double a2 = 1.0 - alpha / a;

    if (std::abs(a0) < 1.0e-12)
        return {};

    return {
        static_cast<float>(b0 / a0),
        static_cast<float>(b1 / a0),
        static_cast<float>(b2 / a0),
        static_cast<float>(a1 / a0),
        static_cast<float>(a2 / a0),
    };
}

inline BiquadCoefficients makeLowShelfCoefficients(
    double sampleRate,
    float frequencyHz,
    float gainDb,
    float q)
{
    if (sampleRate <= 0.0 || std::abs(gainDb) < 0.0001f)
        return {};

    constexpr double pi = 3.14159265358979323846;
    const double safeFrequency = std::clamp<double>(frequencyHz, 10.0, sampleRate * 0.45);
    const double safeShelfSlope = std::max(0.1, static_cast<double>(q));
    const double a = std::pow(10.0, static_cast<double>(gainDb) / 40.0);
    const double omega = 2.0 * pi * safeFrequency / sampleRate;
    const double sinOmega = std::sin(omega);
    const double cosOmega = std::cos(omega);
    const double sqrtA = std::sqrt(a);
    const double alpha = sinOmega / 2.0 * std::sqrt(std::max(0.0, (a + 1.0 / a) * (1.0 / safeShelfSlope - 1.0) + 2.0));
    const double twoSqrtAAlpha = 2.0 * sqrtA * alpha;

    const double b0 = a * ((a + 1.0) - (a - 1.0) * cosOmega + twoSqrtAAlpha);
    const double b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cosOmega);
    const double b2 = a * ((a + 1.0) - (a - 1.0) * cosOmega - twoSqrtAAlpha);
    const double a0 = (a + 1.0) + (a - 1.0) * cosOmega + twoSqrtAAlpha;
    const double a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cosOmega);
    const double a2 = (a + 1.0) + (a - 1.0) * cosOmega - twoSqrtAAlpha;

    if (std::abs(a0) < 1.0e-12)
        return {};

    return {
        static_cast<float>(b0 / a0),
        static_cast<float>(b1 / a0),
        static_cast<float>(b2 / a0),
        static_cast<float>(a1 / a0),
        static_cast<float>(a2 / a0),
    };
}

inline BiquadCoefficients makeHighShelfCoefficients(
    double sampleRate,
    float frequencyHz,
    float gainDb,
    float q)
{
    if (sampleRate <= 0.0 || std::abs(gainDb) < 0.0001f)
        return {};

    constexpr double pi = 3.14159265358979323846;
    const double safeFrequency = std::clamp<double>(frequencyHz, 10.0, sampleRate * 0.45);
    const double safeShelfSlope = std::max(0.1, static_cast<double>(q));
    const double a = std::pow(10.0, static_cast<double>(gainDb) / 40.0);
    const double omega = 2.0 * pi * safeFrequency / sampleRate;
    const double sinOmega = std::sin(omega);
    const double cosOmega = std::cos(omega);
    const double sqrtA = std::sqrt(a);
    const double alpha = sinOmega / 2.0 * std::sqrt(std::max(0.0, (a + 1.0 / a) * (1.0 / safeShelfSlope - 1.0) + 2.0));
    const double twoSqrtAAlpha = 2.0 * sqrtA * alpha;

    const double b0 = a * ((a + 1.0) + (a - 1.0) * cosOmega + twoSqrtAAlpha);
    const double b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cosOmega);
    const double b2 = a * ((a + 1.0) + (a - 1.0) * cosOmega - twoSqrtAAlpha);
    const double a0 = (a + 1.0) - (a - 1.0) * cosOmega + twoSqrtAAlpha;
    const double a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cosOmega);
    const double a2 = (a + 1.0) - (a - 1.0) * cosOmega - twoSqrtAAlpha;

    if (std::abs(a0) < 1.0e-12)
        return {};

    return {
        static_cast<float>(b0 / a0),
        static_cast<float>(b1 / a0),
        static_cast<float>(b2 / a0),
        static_cast<float>(a1 / a0),
        static_cast<float>(a2 / a0),
    };
}

inline BiquadCoefficients makeLowPassCoefficients(
    double sampleRate,
    float frequencyHz,
    float q)
{
    if (sampleRate <= 0.0)
        return {};

    constexpr double pi = 3.14159265358979323846;
    const double safeFrequency = std::clamp<double>(frequencyHz, 10.0, sampleRate * 0.45);
    const double safeQ = std::max(0.1, static_cast<double>(q));
    const double omega = 2.0 * pi * safeFrequency / sampleRate;
    const double sinOmega = std::sin(omega);
    const double cosOmega = std::cos(omega);
    const double alpha = sinOmega / (2.0 * safeQ);

    const double b0 = (1.0 - cosOmega) / 2.0;
    const double b1 = 1.0 - cosOmega;
    const double b2 = (1.0 - cosOmega) / 2.0;
    const double a0 = 1.0 + alpha;
    const double a1 = -2.0 * cosOmega;
    const double a2 = 1.0 - alpha;

    if (std::abs(a0) < 1.0e-12)
        return {};

    return {
        static_cast<float>(b0 / a0),
        static_cast<float>(b1 / a0),
        static_cast<float>(b2 / a0),
        static_cast<float>(a1 / a0),
        static_cast<float>(a2 / a0),
    };
}

inline BiquadCoefficients makeHighPassCoefficients(
    double sampleRate,
    float frequencyHz,
    float q)
{
    if (sampleRate <= 0.0)
        return {};

    constexpr double pi = 3.14159265358979323846;
    const double safeFrequency = std::clamp<double>(frequencyHz, 10.0, sampleRate * 0.45);
    const double safeQ = std::max(0.1, static_cast<double>(q));
    const double omega = 2.0 * pi * safeFrequency / sampleRate;
    const double sinOmega = std::sin(omega);
    const double cosOmega = std::cos(omega);
    const double alpha = sinOmega / (2.0 * safeQ);

    const double b0 = (1.0 + cosOmega) / 2.0;
    const double b1 = -(1.0 + cosOmega);
    const double b2 = (1.0 + cosOmega) / 2.0;
    const double a0 = 1.0 + alpha;
    const double a1 = -2.0 * cosOmega;
    const double a2 = 1.0 - alpha;

    if (std::abs(a0) < 1.0e-12)
        return {};

    return {
        static_cast<float>(b0 / a0),
        static_cast<float>(b1 / a0),
        static_cast<float>(b2 / a0),
        static_cast<float>(a1 / a0),
        static_cast<float>(a2 / a0),
    };
}

inline BiquadCoefficients makeNotchCoefficients(
    double sampleRate,
    float frequencyHz,
    float q)
{
    if (sampleRate <= 0.0)
        return {};

    constexpr double pi = 3.14159265358979323846;
    const double safeFrequency = std::clamp<double>(frequencyHz, 10.0, sampleRate * 0.45);
    const double safeQ = std::max(0.1, static_cast<double>(q));
    const double omega = 2.0 * pi * safeFrequency / sampleRate;
    const double sinOmega = std::sin(omega);
    const double cosOmega = std::cos(omega);
    const double alpha = sinOmega / (2.0 * safeQ);

    const double b0 = 1.0;
    const double b1 = -2.0 * cosOmega;
    const double b2 = 1.0;
    const double a0 = 1.0 + alpha;
    const double a1 = -2.0 * cosOmega;
    const double a2 = 1.0 - alpha;

    if (std::abs(a0) < 1.0e-12)
        return {};

    return {
        static_cast<float>(b0 / a0),
        static_cast<float>(b1 / a0),
        static_cast<float>(b2 / a0),
        static_cast<float>(a1 / a0),
        static_cast<float>(a2 / a0),
    };
}

inline BiquadCoefficients makeEqCoefficients(
    double sampleRate,
    float frequencyHz,
    float gainDb,
    float q,
    EqFilterType filterType,
    bool enabled)
{
    if (! enabled || ! std::isfinite(frequencyHz) || ! std::isfinite(gainDb) || ! std::isfinite(q))
        return {};

    switch (filterType)
    {
        case EqFilterType::LowShelf:
            return makeLowShelfCoefficients(sampleRate, frequencyHz, gainDb, q);
        case EqFilterType::HighShelf:
            return makeHighShelfCoefficients(sampleRate, frequencyHz, gainDb, q);
        case EqFilterType::LowPass:
            return makeLowPassCoefficients(sampleRate, frequencyHz, q);
        case EqFilterType::HighPass:
            return makeHighPassCoefficients(sampleRate, frequencyHz, q);
        case EqFilterType::Notch:
            return makeNotchCoefficients(sampleRate, frequencyHz, q);
        case EqFilterType::Peaking:
        default:
            return makePeakingCoefficients(sampleRate, frequencyHz, gainDb, q);
    }
}
} // namespace echo
