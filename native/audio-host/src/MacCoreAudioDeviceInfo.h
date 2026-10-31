#pragma once

#if defined(__APPLE__)

#include <CoreAudio/CoreAudio.h>

#include <string>

AudioDeviceID getMacCoreAudioDefaultOutputDevice() noexcept;
AudioDeviceID getMacCoreAudioOutputDeviceForUid(const char* uid) noexcept;
std::string getMacCoreAudioDeviceUid(AudioDeviceID device);
int getMacCoreAudioNominalSampleRate(AudioDeviceID device) noexcept;
int getMacCoreAudioNominalSampleRateForUid(const char* uid) noexcept;

#endif

