#include "EqPresetStore.h"

#include <cmath>
#include <utility>

namespace echo
{
namespace
{
EqPreset makePreset(const std::string& id, const std::string& name, float preampDb, const EqGainArray& gains)
{
    EqPreset preset;
    preset.id = id;
    preset.name = name;
    preset.preampDb = clampEqPreampDb(preampDb);
    preset.readonlyPreset = true;
    preset.createdAt = "built-in";
    preset.updatedAt = "built-in";
    preset.bands.reserve(eqBandCount);

    for (int index = 0; index < eqBandCount; ++index)
    {
        preset.bands.push_back({
            eqFrequenciesHz[static_cast<size_t>(index)],
            clampEqGainDb(gains[static_cast<size_t>(index)]),
            1.0f,
            EqFilterType::Peaking,
            true,
        });
    }

    return preset;
}

EqPreset makeParametricPreset(const std::string& id, const std::string& name, float preampDb, std::vector<EqBandState> bands)
{
    EqPreset preset;
    preset.id = id;
    preset.name = name;
    preset.preampDb = clampEqPreampDb(preampDb);
    preset.readonlyPreset = true;
    preset.createdAt = "built-in";
    preset.updatedAt = "built-in";
    preset.bands = std::move(bands);
    if (preset.bands.size() > static_cast<size_t>(eqBandCount))
        preset.bands.resize(static_cast<size_t>(eqBandCount));

    while (preset.bands.size() < static_cast<size_t>(eqBandCount))
    {
        const auto index = preset.bands.size();
        preset.bands.push_back({
            eqFrequenciesHz[index],
            0.0f,
            1.0f,
            EqFilterType::Peaking,
            true,
        });
    }
    return preset;
}
} // namespace

std::vector<EqPreset> EqPresetStore::createBuiltInPresets()
{
    return {
        makePreset("flat", "Flat", 0.0f, {}),
        makePreset("bass-boost", "Bass Boost", -2.0f, { 4.0f, 3.5f, 2.5f, 1.0f, 0.0f, 0.0f, 0.0f, -0.5f, -1.0f, -1.0f }),
        makePreset("vocal-clear", "Vocal Clear", -1.5f, { -2.0f, -1.5f, -1.0f, 0.5f, 1.5f, 2.5f, 2.0f, 1.0f, 0.0f, -0.5f }),
        makePreset("treble-sparkle", "Treble Sparkle", -2.0f, { -1.0f, -0.8f, -0.5f, 0.0f, 0.0f, 0.5f, 1.2f, 2.4f, 3.4f, 3.0f }),
        makePreset("loudness", "Loudness", -4.0f, { 4.0f, 3.5f, 2.0f, 0.5f, -0.5f, -0.5f, 0.3f, 1.5f, 2.2f, 2.4f }),
        makePreset("night", "Night", -4.0f, { -2.0f, -2.0f, -1.5f, -0.5f, 0.0f, 1.0f, 0.8f, -0.5f, -2.0f, -3.0f }),
        makePreset("headphone-warm", "Headphone Warm", -2.0f, { 1.5f, 2.0f, 2.0f, 1.2f, 0.4f, 0.0f, -0.4f, -0.8f, -1.0f, -1.2f }),
        makePreset("anime-jpop", "Anime / J-Pop", -3.0f, { 1.5f, 1.2f, 0.6f, -0.5f, -0.8f, 0.8f, 2.0f, 2.6f, 2.2f, 1.0f }),
        makePreset("rock", "Rock", -3.0f, { 2.5f, 2.0f, 1.0f, -0.5f, -1.0f, 0.0f, 1.2f, 2.3f, 2.0f, 1.2f }),
        makePreset("classical", "Classical", -1.0f, { 0.5f, 0.5f, 0.0f, 0.0f, -0.3f, -0.2f, 0.4f, 1.0f, 1.2f, 0.8f }),
        makeParametricPreset("sub-cleanup", "Sub Cleanup", -2.0f, {
            { 28.0f, 0.0f, 0.7f, EqFilterType::HighPass, true },
            { 70.0f, 1.5f, 0.8f, EqFilterType::LowShelf, true },
            { 125.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 240.0f, -2.5f, 1.1f, EqFilterType::Peaking, true },
            { 500.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 1000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 2000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 4000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 8000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 16000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
        }),
        makeParametricPreset("vocal-de-ess", "Vocal De-ess", -3.0f, {
            { 31.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 62.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 180.0f, -1.5f, 1.0f, EqFilterType::Peaking, true },
            { 250.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 500.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 1000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 3200.0f, 1.5f, 0.9f, EqFilterType::Peaking, true },
            { 4000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 7200.0f, -4.5f, 4.2f, EqFilterType::Peaking, true },
            { 18000.0f, 0.0f, 0.7f, EqFilterType::LowPass, true },
        }),
        makeParametricPreset("headphone-notch", "Headphone Notch", -3.0f, {
            { 35.0f, 1.5f, 0.8f, EqFilterType::LowShelf, true },
            { 62.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 125.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 250.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 500.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 2800.0f, -2.0f, 1.4f, EqFilterType::Peaking, true },
            { 2000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 6200.0f, 0.0f, 7.5f, EqFilterType::Notch, true },
            { 9000.0f, -2.5f, 2.2f, EqFilterType::Peaking, true },
            { 16000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
        }),
        makeParametricPreset("subsonic-filter", "Subsonic Filter", -2.0f, {
            { 24.0f, 0.0f, 0.7f, EqFilterType::HighPass, true },
            { 80.0f, 0.8f, 0.7f, EqFilterType::LowShelf, true },
            { 125.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 250.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 500.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 1000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 2000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 4000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 8000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 16000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
        }),
        makeParametricPreset("sibilance-tamer", "Sibilance Tamer", -4.0f, {
            { 31.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 62.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 180.0f, -1.2f, 1.0f, EqFilterType::Peaking, true },
            { 250.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 500.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 1000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 2000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 5600.0f, -2.8f, 3.5f, EqFilterType::Peaking, true },
            { 8200.0f, 0.0f, 6.0f, EqFilterType::Notch, true },
            { 12500.0f, -1.0f, 0.8f, EqFilterType::HighShelf, true },
        }),
        makeParametricPreset("bluetooth-speaker-cleanup", "Bluetooth Speaker Cleanup", -3.0f, {
            { 55.0f, 0.0f, 0.7f, EqFilterType::HighPass, true },
            { 120.0f, -2.0f, 0.8f, EqFilterType::LowShelf, true },
            { 125.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 420.0f, -2.0f, 1.2f, EqFilterType::Peaking, true },
            { 500.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 1000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 2000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 8500.0f, 2.0f, 0.8f, EqFilterType::HighShelf, true },
            { 8000.0f, 0.0f, 1.0f, EqFilterType::Peaking, true },
            { 18000.0f, 0.0f, 0.7f, EqFilterType::LowPass, true },
        }),
    };
}

bool EqPresetStore::validatePreset(const EqPreset& preset)
{
    if (preset.id.empty() || preset.name.empty() || preset.bands.size() != static_cast<size_t>(eqBandCount))
        return false;

    if (! std::isfinite(preset.preampDb) || preset.preampDb < eqMinPreampDb || preset.preampDb > eqMaxPreampDb)
        return false;

    for (int index = 0; index < eqBandCount; ++index)
    {
        const auto& band = preset.bands[static_cast<size_t>(index)];

        if (! std::isfinite(band.frequencyHz) || band.frequencyHz < eqMinFrequencyHz || band.frequencyHz > eqMaxFrequencyHz)
            return false;

        if (! std::isfinite(band.gainDb) || band.gainDb < eqMinGainDb || band.gainDb > eqMaxGainDb)
            return false;

        if (! std::isfinite(band.q) || band.q <= 0.0f || band.q > 12.0f)
            return false;

        if (normalizeEqFilterType(static_cast<int>(band.filterType)) != band.filterType)
            return false;
    }

    return true;
}
} // namespace echo
