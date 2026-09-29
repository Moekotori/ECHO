#include "HostUtils.h"

#include <iostream>

std::mutex stdoutMutex;

void logLine(const std::string& message)
{
    std::cerr << "[echo-audio-host] " << message << std::endl;
}

long long elapsedMs(std::chrono::steady_clock::time_point started)
{
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - started).count();
}

void writeJsonLine(const std::string& json)
{
    const std::lock_guard<std::mutex> lock(stdoutMutex);
    std::cout << json << std::endl;
}

std::string jsonEscape(std::string_view input)
{
    std::string result;
    result.reserve(input.size() + 8);

    for (char ch : input)
    {
        switch (ch)
        {
            case '\\': result += "\\\\"; break;
            case '"': result += "\\\""; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default: result += ch; break;
        }
    }

    return result;
}

int parseInt(std::string_view value, int fallback)
{
    if (value.empty())
        return fallback;

    try
    {
        return std::stoi(std::string(value));
    }
    catch (...)
    {
        return fallback;
    }
}
