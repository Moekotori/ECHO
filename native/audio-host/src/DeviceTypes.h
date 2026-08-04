#pragma once

#include <algorithm>
#include <cctype>
#include <string>
#include <string_view>

struct DeviceDescriptor
{
    int index = -1;
    std::string typeName;
    std::string name;
    int sampleRate = 0;
    int sharedSampleRate = 0;
    bool isDefault = false;
    bool isAsio = false;
    int asioOutputChannels = 0;
    std::string asioOutputChannelNames;
    std::string stableId;
};

enum class DeviceListMode
{
    Shared,
    Exclusive,
    Asio,
};

inline std::string asciiLower(std::string_view value)
{
    std::string lowered(value);
    std::transform(lowered.begin(), lowered.end(), lowered.begin(), [] (unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return lowered;
}

inline bool containsIgnoreCase(std::string_view text, std::string_view needle)
{
    if (needle.empty())
        return true;
    return asciiLower(text).find(asciiLower(needle)) != std::string::npos;
}

inline bool isAsioType(std::string_view typeName)
{
    return containsIgnoreCase(typeName, "asio");
}

inline bool isExclusiveType(std::string_view typeName)
{
    return containsIgnoreCase(typeName, "exclusive");
}

inline bool isAlsaType(std::string_view typeName)
{
    return containsIgnoreCase(typeName, "alsa");
}

inline bool isJackType(std::string_view typeName)
{
    return containsIgnoreCase(typeName, "jack");
}

inline bool isPreferredSharedType(std::string_view typeName)
{
#ifndef _WIN32
    return ! isExclusiveType(typeName) && isAlsaType(typeName);
#else
    return ! isExclusiveType(typeName)
        && (containsIgnoreCase(typeName, "windows audio")
            || containsIgnoreCase(typeName, "wasapi"));
#endif
}

inline bool isDirectSoundType(std::string_view typeName)
{
    return containsIgnoreCase(typeName, "directsound");
}

inline int sharedTypePriority(std::string_view typeName)
{
#ifndef _WIN32
    if (isAlsaType(typeName))
        return 0;

    if (containsIgnoreCase(typeName, "shared"))
        return 1;

    if (isJackType(typeName))
        return 2;

    return 3;
#else
    if (containsIgnoreCase(typeName, "shared"))
        return 0;

    if (containsIgnoreCase(typeName, "windows audio") || containsIgnoreCase(typeName, "wasapi"))
        return 1;

    if (containsIgnoreCase(typeName, "directsound"))
        return 2;

    return 3;
#endif
}

inline bool shouldIncludeType(std::string_view typeName, DeviceListMode mode)
{
    const bool asioType = isAsioType(typeName);
    const bool exclusiveType = isExclusiveType(typeName);

    if (mode == DeviceListMode::Asio)
        return asioType;

    if (asioType)
        return false;

    if (mode == DeviceListMode::Exclusive)
        return exclusiveType;

    return ! exclusiveType;
}

inline bool shouldIncludeSharedBackendType(std::string_view typeName, std::string_view sharedBackend)
{
    if (sharedBackend == "alsa")
        return isAlsaType(typeName);

    if (sharedBackend == "windows")
#ifdef _WIN32
        return isPreferredSharedType(typeName);
#else
        return false;
#endif

    if (sharedBackend == "directsound")
        return isDirectSoundType(typeName);

    return ! isDirectSoundType(typeName);
}
