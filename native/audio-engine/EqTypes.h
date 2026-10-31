#pragma once

#include <array>
#include <cmath>
#include <string>
#include <vector>

namespace echo
{
constexpr int eqBandCount = 31;
constexpr float eqMinGainDb = -12.0f;
constexpr float eqMaxGainDb = 12.0f;
constexpr float eqMinPreampDb = -12.0f;
constexpr float eqMaxPreampDb = 6.0f;
constexpr float eqMinFrequencyHz = 20.0f;
constexpr float eqMaxFrequencyHz = 20000.0f;
constexpr float eqMinQ = 0.1f;
constexpr float eqMaxQ = 12.0f;

enum class EqFilterType : int
{
    Peaking = 0,
    LowShelf = 1,
    HighShelf = 2,
    LowPass = 3,
    HighPass = 4,
    Notch = 5,
};

using EqGainArray = std::array<float, eqBandCount>;
using EqFrequencyArray = std::array<float, eqBandCount>;
using EqQArray = std::array<float, eqBandCount>;
using EqFilterTypeArray = std::array<EqFilterType, eqBandCount>;
using EqBandEnabledArray = std::array<bool, eqBandCount>;

inline constexpr EqFrequencyArray eqFrequenciesHz {
    20.0f,
    25.0f,
    31.5f,
    40.0f,
    50.0f,
    63.0f,
    80.0f,
    100.0f,
    125.0f,
    160.0f,
    200.0f,
    250.0f,
    315.0f,
    400.0f,
    500.0f,
    630.0f,
    800.0f,
    1000.0f,
    1250.0f,
    1600.0f,
    2000.0f,
    2500.0f,
    3150.0f,
    4000.0f,
    5000.0f,
    6300.0f,
    8000.0f,
    10000.0f,
    12500.0f,
    16000.0f,
    20000.0f,
};

inline constexpr EqQArray eqDefaultQ {
    1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f,
    1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f,
    1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f,
    1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f,
};

inline constexpr EqBandEnabledArray eqDefaultBandEnabled {
    true, true, true, true, true, true, true, true,
    true, true, true, true, true, true, true, true,
    true, true, true, true, true, true, true, true,
    true, true, true, true, true, true, true,
};

struct EqBandState
{
    float frequencyHz = 1000.0f;
    float gainDb = 0.0f;
    float q = 1.0f;
    EqFilterType filterType = EqFilterType::Peaking;
    bool enabled = true;
};

struct EqState
{
    bool enabled = false;
    float preampDb = 0.0f;
    EqGainArray bandGainsDb {};
    EqFrequencyArray bandFrequenciesHz = eqFrequenciesHz;
    EqQArray bandQ = eqDefaultQ;
    EqFilterTypeArray bandFilterTypes {};
    EqBandEnabledArray bandEnabled = eqDefaultBandEnabled;
    std::string presetName = "Flat";
};

struct EqPreset
{
    std::string id;
    std::string name;
    float preampDb = 0.0f;
    std::vector<EqBandState> bands;
    std::string createdAt;
    std::string updatedAt;
    bool readonlyPreset = false;
};

inline float clampEqGainDb(float value)
{
    if (! std::isfinite(value))
        return 0.0f;

    if (value < eqMinGainDb)
        return eqMinGainDb;

    if (value > eqMaxGainDb)
        return eqMaxGainDb;

    return value;
}

inline float clampEqPreampDb(float value)
{
    if (! std::isfinite(value))
        return 0.0f;

    if (value < eqMinPreampDb)
        return eqMinPreampDb;

    if (value > eqMaxPreampDb)
        return eqMaxPreampDb;

    return value;
}

inline float clampEqFrequencyHz(float value)
{
    if (! std::isfinite(value))
        return 1000.0f;

    if (value < eqMinFrequencyHz)
        return eqMinFrequencyHz;

    if (value > eqMaxFrequencyHz)
        return eqMaxFrequencyHz;

    return value;
}

inline float clampEqQ(float value)
{
    if (! std::isfinite(value))
        return 1.0f;

    if (value < eqMinQ)
        return eqMinQ;

    if (value > eqMaxQ)
        return eqMaxQ;

    return value;
}

inline EqFilterType normalizeEqFilterType(int value)
{
    switch (static_cast<EqFilterType>(value))
    {
        case EqFilterType::LowShelf:
            return EqFilterType::LowShelf;
        case EqFilterType::HighShelf:
            return EqFilterType::HighShelf;
        case EqFilterType::LowPass:
            return EqFilterType::LowPass;
        case EqFilterType::HighPass:
            return EqFilterType::HighPass;
        case EqFilterType::Notch:
            return EqFilterType::Notch;
        case EqFilterType::Peaking:
        default:
            return EqFilterType::Peaking;
    }
}
} // namespace echo
