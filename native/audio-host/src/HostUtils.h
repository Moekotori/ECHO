#pragma once

#include <chrono>
#include <mutex>
#include <string>
#include <string_view>

extern std::mutex stdoutMutex;

void logLine(const std::string& message);
long long elapsedMs(std::chrono::steady_clock::time_point started);
void writeJsonLine(const std::string& json);
std::string jsonEscape(std::string_view input);
int parseInt(std::string_view value, int fallback);
