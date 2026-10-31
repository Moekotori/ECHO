#pragma once

#include "EqTypes.h"

#include <vector>

namespace echo
{
class EqPresetStore
{
public:
    static std::vector<EqPreset> createBuiltInPresets();
    static bool validatePreset(const EqPreset& preset);
};
} // namespace echo
