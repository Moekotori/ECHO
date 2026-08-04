#pragma once

#include <string>

struct Options
{
    bool list = false;
    bool asio = false;
    bool exclusive = false;
    int sampleRate = 44100;
    int channels = 2;
    int deviceIndex = -1;
    int bufferSize = 0;
    int asioOutputChannelStart = 0;
    int fifoCapacityMs = 0;
    int startupPrebufferMs = 0;
    int startupPrebufferTimeoutMs = 0;
    bool startupPrebufferMsSpecified = false;
    bool startupPrebufferTimeoutMsSpecified = false;
    bool decodePcm = false;
    double decodeStartSeconds = 0.0;
    int eqControlPort = 0;
    int rpcStdinFd = -1;
    int rpcStdoutFd = -1;
    bool noStdin = false;
    bool deviceOpenDeferred = false;
    double volume = 1.0;
    std::string deviceName;
    std::string deviceId;
    std::string decodeFile;
    std::string sharedBackend = "auto";
};
