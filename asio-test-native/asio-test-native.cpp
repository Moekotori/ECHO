/**
 * ASIO DSD Output Test Program - Simplified & Fixed Version
 * 
 * Usage:
 *   asiotest.exe                          - List ASIO devices
 *   asiotest.exe -device <name>           - Select ASIO device
 *   asiotest.exe -device <name> -dop      - Use DoP mode instead of native DSD
 *   asiotest.exe -device <name> -file <path> - Play DSD file
 *   asiotest.exe -device <name> -test     - Test silence output
 * 
 * Supported formats: DSF (DSD64/128/256)
 */

#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

// ASIO SDK includes
#include "asiosys.h"
#include "asio.h"
#include "asiodrivers.h"

#ifdef _WIN32
#define MAX_ASIO_CHANNELS 8
#define MAX_ASIO_TOTAL (MAX_ASIO_CHANNELS * 2)

// ASIO runtime state
typedef struct {
    ASIODriverInfo driverInfo;
    ASIOCallbacks callbacks;
    ASIOBufferInfo bufferInfos[MAX_ASIO_TOTAL];
    ASIOChannelInfo channelInfos[MAX_ASIO_TOTAL];
    long inputChannels;
    long outputChannels;
    long totalChannels;
    long bufferSize;
    ASIOSampleRate sampleRate;
    float* scratchBuffer;
    long scratchFrames;
    long framesInBuffer;
    int playing;
    int channels;
    int dsdMode;           // 1 = native DSD, 0 = DoP
    int useDoP;            // Force DoP mode
    HWND hostWindow;
} AsioState;

static AsioState g_asio;
static AsioDrivers* g_drivers = NULL;

// DSD file reader state
typedef struct {
    FILE* fp;
    unsigned char* data;
    long dataSize;
    long dataPos;          // 全局读取位置（字节偏移）
    int isDFF;             // 1 = DFF, 0 = DSF
    int dsdRate;           // 64, 128, 256
    int channels;
    long sampleRate;       // DSD sample rate (e.g., 2822400)
    long pcmSampleRate;    // PCM sample rate for DoP (176400 or 352800)
    long long totalSamples;
    long blockSize;        // DSF block size (typically 4096)
} DsdFile;

static DsdFile g_dsd;

// Forward declarations
static int listAsioDevices(void);
static int initAsioDevice(const char* deviceName);
static void deinitAsio(void);
static int loadDsdFile(const char* filePath);
static void closeDsdFile(void);
static void asioBufferSwitch(long doubleBufferIndex, ASIOBool directProcess);
static void asioSampleRateDidChange(ASIOSampleRate sRate);
static long asioMessages(long selector, long value, void* message, double* opt);
static unsigned char reverseBits(unsigned char byte);

// Window procedure for ASIO host
static LRESULT CALLBACK asioHostWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    return DefWindowProc(hwnd, msg, wParam, lParam);
}

static HWND createAsioHostWindow(void) {
    WNDCLASSEX wc;
    memset(&wc, 0, sizeof(wc));
    wc.cbSize = sizeof(WNDCLASSEX);
    wc.lpfnWndProc = asioHostWndProc;
    wc.hInstance = GetModuleHandle(NULL);
    wc.lpszClassName = "AsioDsdTestHost";
    
    if (!RegisterClassEx(&wc)) {
        return NULL;
    }
    
    return CreateWindow(
        "AsioDsdTestHost", "ASIO DSD Test",
        WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT, 1, 1,
        NULL, NULL, GetModuleHandle(NULL), NULL
    );
}

static int listAsioDevices(void) {
    HRESULT hr = CoInitialize(NULL);
    if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
        fprintf(stderr, "Failed to initialize COM: 0x%08lX\n", (long)hr);
        return -1;
    }
    
    if (!g_drivers) {
        g_drivers = new AsioDrivers();
    }
    
    if (!g_drivers) {
        fprintf(stderr, "Failed to create AsioDrivers instance\n");
        CoUninitialize();
        return -1;
    }
    
    long count = g_drivers->asioGetNumDev();
    printf("AsioDrivers::asioGetNumDev() returned: %ld\n", count);
    
    if (count <= 0) {
        printf("No ASIO devices found in registry.\n");
        printf("Check HKEY_LOCAL_MACHINE\\SOFTWARE\\asio\n");
        CoUninitialize();
        return -1;
    }
    
    char** names = (char**)calloc(count, sizeof(char*));
    for (long i = 0; i < count; i++) {
        names[i] = (char*)calloc(256, 1);
    }
    
    long got = g_drivers->getDriverNames(names, count);
    printf("getDriverNames returned: %ld\n", got);
    
    printf("Found %ld ASIO device(s):\n", got);
    for (long i = 0; i < got; i++) {
        printf("  %ld: %s\n", i, names[i]);
        free(names[i]);
    }
    free(names);
    
    CoUninitialize();
    return 0;
}

static int initAsioDevice(const char* deviceName) {
    memset(&g_asio, 0, sizeof(g_asio));
    
    if (!g_drivers) {
        g_drivers = new AsioDrivers();
    }
    
    g_asio.hostWindow = createAsioHostWindow();
    if (!g_asio.hostWindow) {
        fprintf(stderr, "Failed to create ASIO host window\n");
        return -1;
    }
    
    if (!g_drivers->loadDriver((char*)deviceName)) {
        fprintf(stderr, "Failed to load ASIO driver: %s\n", deviceName);
        return -1;
    }
    
    g_asio.driverInfo.asioVersion = 2;
    g_asio.driverInfo.sysRef = g_asio.hostWindow;
    
    if (ASIOInit(&g_asio.driverInfo) != ASE_OK) {
        fprintf(stderr, "ASIOInit failed: %s\n", g_asio.driverInfo.errorMessage);
        return -1;
    }
    
    printf("ASIO Driver: %s\n", g_asio.driverInfo.name);
    printf("ASIO Version: %ld\n", g_asio.driverInfo.asioVersion);
    
    if (ASIOGetChannels(&g_asio.inputChannels, &g_asio.outputChannels) != ASE_OK) {
        fprintf(stderr, "ASIOGetChannels failed\n");
        ASIOExit();
        return -1;
    }
    
    if (g_asio.outputChannels <= 0) {
        fprintf(stderr, "No output channels available\n");
        ASIOExit();
        return -1;
    }
    
    printf("Output channels: %ld\n", g_asio.outputChannels);
    
    long minSize, maxSize, preferredSize, granularity;
    if (ASIOGetBufferSize(&minSize, &maxSize, &preferredSize, &granularity) != ASE_OK) {
        fprintf(stderr, "ASIOGetBufferSize failed\n");
        ASIOExit();
        return -1;
    }
    
    g_asio.bufferSize = preferredSize;
    printf("Buffer size: %ld (min=%ld, max=%ld)\n", g_asio.bufferSize, minSize, maxSize);
    
    if (ASIOGetSampleRate(&g_asio.sampleRate) != ASE_OK) {
        fprintf(stderr, "ASIOGetSampleRate failed\n");
        ASIOExit();
        return -1;
    }
    
    printf("Sample rate: %.0f Hz (%.1f MHz)\n", g_asio.sampleRate, g_asio.sampleRate / 1000000.0);
    
    g_asio.totalChannels = g_asio.outputChannels;
    if (g_asio.totalChannels > MAX_ASIO_TOTAL) {
        printf("Warning: Limiting channels from %ld to %d\n", g_asio.totalChannels, MAX_ASIO_TOTAL);
        g_asio.totalChannels = MAX_ASIO_TOTAL;
    }
    
    for (long i = 0; i < g_asio.totalChannels; i++) {
        g_asio.bufferInfos[i].isInput = ASIOFalse;
        g_asio.bufferInfos[i].channelNum = i;
    }
    
    g_asio.callbacks.bufferSwitch = &asioBufferSwitch;
    g_asio.callbacks.sampleRateDidChange = &asioSampleRateDidChange;
    g_asio.callbacks.asioMessage = &asioMessages;
    g_asio.callbacks.bufferSwitchTimeInfo = NULL;
    
    g_asio.scratchFrames = g_asio.bufferSize;
    g_asio.scratchBuffer = (float*)calloc(g_asio.scratchFrames * g_asio.totalChannels, sizeof(float));
    if (!g_asio.scratchBuffer) {
        fprintf(stderr, "Failed to allocate scratch buffer\n");
        ASIOExit();
        return -1;
    }
    
    return 0;
}

static void deinitAsio(void) {
    if (g_asio.scratchBuffer) {
        free(g_asio.scratchBuffer);
        g_asio.scratchBuffer = NULL;
    }
    
    ASIOExit();
    
    if (g_asio.hostWindow) {
        DestroyWindow(g_asio.hostWindow);
        UnregisterClass("AsioDsdTestHost", GetModuleHandle(NULL));
        g_asio.hostWindow = NULL;
    }
}

// Reverse bits in a byte (MSB <-> LSB)
static unsigned char reverseBits(unsigned char byte) {
    byte = (byte & 0xF0) >> 4 | (byte & 0x0F) << 4;
    byte = (byte & 0xCC) >> 2 | (byte & 0x33) << 2;
    byte = (byte & 0xAA) >> 1 | (byte & 0x55) << 1;
    return byte;
}

/**
 * 从 DSF 数据中读取指定通道的指定偏移处的字节
 * 
 * DSF 数据排列方式（双声道为例）：
 *   [Ch0 Block0: 4096 bytes][Ch1 Block0: 4096 bytes]
 *   [Ch0 Block1: 4096 bytes][Ch1 Block1: 4096 bytes]
 *   ...
 * 
 * 参数:
 *   channel: 要读取的通道 (0-based)
 *   globalOffset: 全局偏移（按通道连续数据计算，不考虑交错）
 * 返回:
 *   数据字节，如果超出范围则返回 0
 */
static unsigned char readDsfByte(int channel, long globalOffset) {
    if (channel < 0 || channel >= g_dsd.channels) {
        return 0;
    }
    
    long blockSize = g_dsd.blockSize;
    
    // 计算该全局偏移属于第几个 block
    long blockIndex = globalOffset / blockSize;
    // 计算在 block 内的偏移
    long offsetInBlock = globalOffset % blockSize;
    
    // 在 DSF 文件中，该字节的实际位置：
    // 先跳过 (blockIndex * channels + channel) 个 block
    // 再加上 block 内的偏移
    long fileOffset = (blockIndex * g_dsd.channels + channel) * blockSize + offsetInBlock;
    
    if (fileOffset >= 0 && fileOffset < g_dsd.dataSize) {
        return g_dsd.data[fileOffset];
    }
    
    return 0;
}

static int startAsioPlayback(int channels) {
    g_asio.channels = channels;
    g_asio.playing = 1;
    g_asio.framesInBuffer = 0;
    
    if (!g_asio.useDoP) {
        // Try to enable native DSD mode
        ASIOIoFormat dsdFormat;
        memset(&dsdFormat, 0, sizeof(dsdFormat));
        dsdFormat.FormatType = kASIODSDFormat;
        
        if (ASIOFuture(kAsioCanDoIoFormat, &dsdFormat) == ASE_SUCCESS) {
            printf("  Device supports native DSD format\n");
            if (ASIOFuture(kAsioSetIoFormat, &dsdFormat) == ASE_SUCCESS) {
                printf("  Switched to native DSD mode\n");
                g_asio.dsdMode = 1;
                
                double dsdSampleRate = (double)g_dsd.sampleRate;
                if (ASIOSetSampleRate(dsdSampleRate) != ASE_OK) {
                    printf("  Warning: Failed to set DSD sample rate to %.0f Hz\n", dsdSampleRate);
                    printf("  Falling back to DoP mode\n");
                    g_asio.dsdMode = 0;
                    g_asio.useDoP = 1;
                } else {
                    printf("  Set DSD sample rate to %.0f Hz\n", dsdSampleRate);
                    long minSize, maxSize, preferredSize, granularity;
                    if (ASIOGetBufferSize(&minSize, &maxSize, &preferredSize, &granularity) == ASE_OK) {
                        g_asio.bufferSize = preferredSize;
                        printf("  Updated buffer size: %ld\n", g_asio.bufferSize);
                    }
                }
            }
        }
    }
    
    if (!g_asio.dsdMode) {
        printf("  Using DoP (DSD over PCM) mode\n");
        g_asio.useDoP = 1;
        
        double dopSampleRate = 0;
        switch (g_dsd.dsdRate) {
            case 64:  dopSampleRate = 176400.0; break;
            case 128: dopSampleRate = 352800.0; break;
            case 256: dopSampleRate = 705600.0; break;
            default:  dopSampleRate = 176400.0; break;
        }
        
        if (ASIOSetSampleRate(dopSampleRate) != ASE_OK) {
            printf("  Warning: Failed to set DoP sample rate to %.0f Hz, trying 176400 Hz\n", dopSampleRate);
            if (ASIOSetSampleRate(176400.0) != ASE_OK) {
                printf("  Error: Cannot set compatible sample rate for DoP\n");
                return -1;
            }
            dopSampleRate = 176400.0;
        }
        printf("  Set DoP sample rate to %.0f Hz\n", dopSampleRate);
    }
    
    if (ASIOCreateBuffers(g_asio.bufferInfos, g_asio.totalChannels, g_asio.bufferSize, &g_asio.callbacks) != ASE_OK) {
        fprintf(stderr, "ASIOCreateBuffers failed\n");
        return -1;
    }
    
    for (long i = 0; i < g_asio.totalChannels; i++) {
        g_asio.channelInfos[i].channel = i;
        g_asio.channelInfos[i].isInput = ASIOFalse;
        if (ASIOGetChannelInfo(&g_asio.channelInfos[i]) != ASE_OK) {
            fprintf(stderr, "ASIOGetChannelInfo failed for channel %ld\n", i);
        } else {
            printf("  Channel %ld: type=%ld", i, g_asio.channelInfos[i].type);
            if (g_asio.channelInfos[i].type == ASIOSTDSDInt8LSB1) {
                printf(" (DSD LSB)\n");
            } else if (g_asio.channelInfos[i].type == ASIOSTDSDInt8MSB1) {
                printf(" (DSD MSB)\n");
            } else if (g_asio.channelInfos[i].type == ASIOSTInt32LSB) {
                printf(" (PCM 32-bit)\n");
            } else if (g_asio.channelInfos[i].type == ASIOSTInt24LSB) {
                printf(" (PCM 24-bit)\n");
            } else {
                printf("\n");
            }
        }
    }
    
    if (ASIOStart() != ASE_OK) {
        fprintf(stderr, "ASIOStart failed\n");
        ASIODisposeBuffers();
        return -1;
    }
    
    printf("ASIO playback started\n");
    return 0;
}

static void stopAsioPlayback(void) {
    g_asio.playing = 0;
    ASIOStop();
    ASIODisposeBuffers();
    printf("ASIO playback stopped\n");
}

static int loadDsdFile(const char* filePath) {
    memset(&g_dsd, 0, sizeof(g_dsd));
    
    FILE* testFp = fopen(filePath, "rb");
    if (!testFp) {
        fprintf(stderr, "Cannot open file: %s\n", filePath);
        return -1;
    }
    
    fseek(testFp, 0, SEEK_END);
    long fileLen = ftell(testFp);
    fclose(testFp);
    
    if (fileLen < 1024) {
        fprintf(stderr, "File too small (%ld bytes) - not a valid DSD file\n", fileLen);
        return -1;
    }
    
    g_dsd.fp = fopen(filePath, "rb");
    if (!g_dsd.fp) {
        fprintf(stderr, "Cannot open file: %s\n", filePath);
        return -1;
    }
    
    char header[16];
    if (fread(header, 1, 16, g_dsd.fp) != 16) {
        fprintf(stderr, "Failed to read header\n");
        fclose(g_dsd.fp);
        return -1;
    }
    
    if (memcmp(header, "DSD ", 4) == 0) {
        g_dsd.isDFF = 0;
        printf("Format: DSF (DSD Stream File)\n");
    } else {
        fprintf(stderr, "Unknown format (header: %.8s)\n", header);
        fclose(g_dsd.fp);
        return -1;
    }
    
    // Parse DSF file header
    uint64_t headerSize, actualFileSize, metaPtr;
    fseek(g_dsd.fp, 4, SEEK_SET);
    fread(&headerSize, 8, 1, g_dsd.fp);
    fread(&actualFileSize, 8, 1, g_dsd.fp);
    fread(&metaPtr, 8, 1, g_dsd.fp);
    
    printf("Header size: %llu bytes\n", headerSize);
    printf("File size: %llu bytes\n", actualFileSize);
    
    // Read fmt chunk
    fseek(g_dsd.fp, 28, SEEK_SET);
    
    char chunkId[5] = {0};
    uint64_t chunkSize;
    fread(chunkId, 4, 1, g_dsd.fp);
    chunkId[4] = '\0';
    fread(&chunkSize, 8, 1, g_dsd.fp);
    
    if (strcmp(chunkId, "fmt ") != 0) {
        fprintf(stderr, "Expected fmt chunk, got %s\n", chunkId);
        fclose(g_dsd.fp);
        return -1;
    }
    
    uint32_t formatVersion, formatID, channelType, channelNum;
    uint32_t sampleRate;
    uint32_t bitsPerSample;
    uint64_t sampleCount;
    uint32_t blockSize;
    uint32_t reserved;
    
    fread(&formatVersion, 4, 1, g_dsd.fp);
    fread(&formatID, 4, 1, g_dsd.fp);
    fread(&channelType, 4, 1, g_dsd.fp);
    fread(&channelNum, 4, 1, g_dsd.fp);
    fread(&sampleRate, 4, 1, g_dsd.fp);
    fread(&bitsPerSample, 4, 1, g_dsd.fp);
    fread(&sampleCount, 8, 1, g_dsd.fp);
    fread(&blockSize, 4, 1, g_dsd.fp);
    fread(&reserved, 4, 1, g_dsd.fp);
    
    g_dsd.channels = channelNum;
    g_dsd.sampleRate = sampleRate;
    g_dsd.totalSamples = sampleCount;
    g_dsd.blockSize = blockSize;
    
    if (sampleRate >= 11289600) {
        g_dsd.dsdRate = 256;
    } else if (sampleRate >= 5644800) {
        g_dsd.dsdRate = 128;
    } else if (sampleRate >= 2822400) {
        g_dsd.dsdRate = 64;
    } else {
        g_dsd.dsdRate = 64;
    }
    
    g_dsd.pcmSampleRate = g_dsd.sampleRate / 16;
    
    printf("DSF: %u channels, %u Hz (DSD%d), %llu samples\n",
           channelNum, sampleRate, g_dsd.dsdRate, sampleCount);
    printf("      Block size: %u bytes\n", blockSize);
    printf("      DoP mode would use: %.0f Hz PCM\n", (double)g_dsd.pcmSampleRate);
    
    // Seek to data chunk
    long dataChunkOffset = 28 + (long)chunkSize;
    fseek(g_dsd.fp, dataChunkOffset, SEEK_SET);
    
    memset(chunkId, 0, sizeof(chunkId));
    fread(chunkId, 4, 1, g_dsd.fp);
    chunkId[4] = '\0';
    fread(&chunkSize, 8, 1, g_dsd.fp);
    printf("Data chunk: %s, size: %llu\n", chunkId, chunkSize);
    
    if (strcmp(chunkId, "data") != 0) {
        fprintf(stderr, "Expected data chunk, got %s\n", chunkId);
        fclose(g_dsd.fp);
        return -1;
    }
    
    g_dsd.dataSize = (long)chunkSize;
    g_dsd.data = (unsigned char*)malloc(g_dsd.dataSize);
    if (!g_dsd.data) {
        fprintf(stderr, "Failed to allocate %ld bytes for DSD data\n", g_dsd.dataSize);
        fclose(g_dsd.fp);
        return -1;
    }
    
    long bytesRead = fread(g_dsd.data, 1, g_dsd.dataSize, g_dsd.fp);
    printf("Read %ld / %ld bytes of DSD data\n", bytesRead, g_dsd.dataSize);
    
    if (bytesRead != g_dsd.dataSize) {
        fprintf(stderr, "Warning: Only read %ld of %ld bytes\n", bytesRead, g_dsd.dataSize);
        g_dsd.dataSize = bytesRead;
    }
    
    g_dsd.dataPos = 0;
    
    return 0;
}

static void closeDsdFile(void) {
    if (g_dsd.data) {
        free(g_dsd.data);
        g_dsd.data = NULL;
    }
    if (g_dsd.fp) {
        fclose(g_dsd.fp);
        g_dsd.fp = NULL;
    }
}

// ===================================================================
// ASIO 缓冲区切换回调 - 简化版，使用 readDsfByte() 辅助函数
// ===================================================================
static void asioBufferSwitch(long doubleBufferIndex, ASIOBool directProcess) {
    (void)directProcess;  // 消除编译警告
    
    if (!g_asio.playing) return;
    
    long frames = g_asio.bufferSize;
    long channels = g_asio.channels;
    
    if (g_asio.dsdMode && g_asio.dsdMode == 1) {
        // ============================================================
        // 原生 DSD 模式
        // ============================================================
        // 每个通道每帧需要 1 位，每通道需要 (frames/8) 字节
        // dataPos 是每个通道已经读取的字节数（按通道连续数据计）
        
        if (g_dsd.data && g_dsd.dataPos < g_dsd.dataSize) {
            long bytesPerChannel = (frames + 7) / 8;
            long bytesAvailable = g_dsd.dataSize / g_dsd.channels - g_dsd.dataPos;
            long bytesToRead = (bytesPerChannel < bytesAvailable) ? bytesPerChannel : bytesAvailable;
            
            for (long ch = 0; ch < channels && ch < g_asio.totalChannels; ch++) {
                void* buffer = g_asio.bufferInfos[ch].buffers[doubleBufferIndex];
                unsigned char* buf = (unsigned char*)buffer;
                memset(buf, 0, bytesPerChannel);
                
                // 从每个通道的连续数据中读取
                for (long i = 0; i < bytesToRead; i++) {
                    long globalOffset = g_dsd.dataPos + i;
                    unsigned char byteVal = readDsfByte(ch, globalOffset);
                    // 反转位序：DSF LSB -> ASIO DSD MSB
                    buf[i] = reverseBits(byteVal);
                }
            }
            
            g_dsd.dataPos += bytesToRead;
            
            static long debugCounter = 0;
            if (debugCounter++ % 200 == 0) {
                long totalPerChannel = g_dsd.dataSize / g_dsd.channels;
                printf("  [Native DSD] bytesPerCh=%ld/%ld, dataPos=%ld/%ld\n", 
                       bytesPerChannel, bytesToRead, g_dsd.dataPos, totalPerChannel);
            }
            
            if (g_dsd.dataPos >= g_dsd.dataSize / g_dsd.channels) {
                printf("End of DSD file reached\n");
                g_asio.playing = 0;
            }
        } else {
            // 输出 DSD 静音
            for (long ch = 0; ch < g_asio.totalChannels && ch < channels; ch++) {
                void* buffer = g_asio.bufferInfos[ch].buffers[doubleBufferIndex];
                long bytesPerChannel = (frames + 7) / 8;
                memset(buffer, 0x69, bytesPerChannel);
            }
        }
    } else {
        // ============================================================
        // DoP (DSD over PCM) 模式
        // ============================================================
        // DoP: 每帧传输16位DSD数据(2字节)，封装在24位PCM中
        // marker字节: 0x05 和 0xFA 交替
        
        if (g_dsd.data && g_dsd.dataPos < g_dsd.dataSize) {
            // 每个通道每帧需要 2 字节 DSD 数据
            long dsdBytesPerChannel = frames * 2;
            long bytesAvailable = (g_dsd.dataSize / g_dsd.channels) - g_dsd.dataPos;
            long bytesToRead = (dsdBytesPerChannel < bytesAvailable) ? dsdBytesPerChannel : bytesAvailable;
            
            for (long ch = 0; ch < channels && ch < g_asio.totalChannels; ch++) {
                void* buffer = g_asio.bufferInfos[ch].buffers[doubleBufferIndex];
                
                // 根据 ASIO 通道格式选择输出方式
                if (g_asio.channelInfos[ch].type == ASIOSTInt32LSB) {
                    int* buf32 = (int*)buffer;
                    
                    for (long frame = 0; frame < frames; frame++) {
                        // DoP marker: 0x05 和 0xFA 交替
                        unsigned char marker = (frame % 2 == 0) ? 0x05 : 0xFA;
                        
                        long dsdByteIdx = g_dsd.dataPos + frame * 2;
                        unsigned char dsdByte1 = 0, dsdByte2 = 0;
                        
                        if (dsdByteIdx < bytesAvailable) {
                            dsdByte1 = readDsfByte(ch, dsdByteIdx);
                        }
                        if (dsdByteIdx + 1 < bytesAvailable) {
                            dsdByte2 = readDsfByte(ch, dsdByteIdx + 1);
                        }
                        
                        // 构建 32-bit DoP 采样: [marker][marker][DSD_byte1][DSD_byte2]
                        int sample = (marker << 24) | (marker << 16) | (dsdByte1 << 8) | dsdByte2;
                        buf32[frame] = sample;
                    }
                } else if (g_asio.channelInfos[ch].type == ASIOSTInt24LSB) {
                    unsigned char* buf24 = (unsigned char*)buffer;
                    
                    for (long frame = 0; frame < frames; frame++) {
                        unsigned char marker = (frame % 2 == 0) ? 0x05 : 0xFA;
                        
                        long dsdByteIdx = g_dsd.dataPos + frame * 2;
                        unsigned char dsdByte1 = 0, dsdByte2 = 0;
                        
                        if (dsdByteIdx < bytesAvailable) {
                            dsdByte1 = readDsfByte(ch, dsdByteIdx);
                        }
                        if (dsdByteIdx + 1 < bytesAvailable) {
                            dsdByte2 = readDsfByte(ch, dsdByteIdx + 1);
                        }
                        
                        // 24-bit 格式: [marker][DSD_byte1][DSD_byte2]
                        long offset = frame * 3;
                        buf24[offset + 0] = marker;
                        buf24[offset + 1] = dsdByte1;
                        buf24[offset + 2] = dsdByte2;
                    }
                }
            }
            
            g_dsd.dataPos += bytesToRead;
            
            static long debugCounter = 0;
            if (debugCounter++ % 200 == 0) {
                long totalPerChannel = g_dsd.dataSize / g_dsd.channels;
                printf("  [DoP] dsdBytesPerCh=%ld/%ld, dataPos=%ld/%ld\n", 
                       dsdBytesPerChannel, bytesToRead, g_dsd.dataPos, totalPerChannel);
            }
            
            if (g_dsd.dataPos >= g_dsd.dataSize / g_dsd.channels) {
                printf("End of DSD file reached\n");
                g_asio.playing = 0;
            }
        } else {
            // DoP 静音输出
            for (long ch = 0; ch < g_asio.totalChannels && ch < channels; ch++) {
                void* buffer = g_asio.bufferInfos[ch].buffers[doubleBufferIndex];
                
                if (g_asio.channelInfos[ch].type == ASIOSTInt32LSB) {
                    int* buf32 = (int*)buffer;
                    for (long frame = 0; frame < frames; frame++) {
                        unsigned char marker = (frame % 2 == 0) ? 0x05 : 0xFA;
                        buf32[frame] = (marker << 24) | (marker << 16);
                    }
                } else if (g_asio.channelInfos[ch].type == ASIOSTInt24LSB) {
                    unsigned char* buf24 = (unsigned char*)buffer;
                    memset(buf24, 0, frames * 3);
                    for (long frame = 0; frame < frames; frame++) {
                        unsigned char marker = (frame % 2 == 0) ? 0x05 : 0xFA;
                        buf24[frame * 3 + 0] = marker;
                    }
                }
            }
        }
    }
    
    if (!g_asio.playing) {
        printf("Playback complete, stopping...\n");
        stopAsioPlayback();
    }
}

static void asioSampleRateDidChange(ASIOSampleRate sRate) {
    printf("Sample rate changed to: %.0f Hz\n", sRate);
}

static long asioMessages(long selector, long value, void* message, double* opt) {
    (void)message;
    (void)opt;
    
    switch (selector) {
        case kAsioSelectorSupported:
            return (value == kAsioEngineVersion || 
                    value == kAsioResetRequest ||
                    value == kAsioBufferSizeChange ||
                    value == kAsioResyncRequest ||
                    value == kAsioLatenciesChanged) ? 1 : 0;
        case kAsioEngineVersion:
            return 2;
        case kAsioResetRequest:
        case kAsioResyncRequest:
        case kAsioLatenciesChanged:
            return 1;
        default:
            return 0;
    }
}

// Main
int main(int argc, char** argv) {
    SetConsoleOutputCP(CP_UTF8);
    
    const char* deviceName = NULL;
    const char* filePath = NULL;
    int testMode = 0;
    int forceDoP = 0;
    
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-device") == 0 && i + 1 < argc) {
            deviceName = argv[++i];
        } else if (strcmp(argv[i], "-file") == 0 && i + 1 < argc) {
            filePath = argv[++i];
        } else if (strcmp(argv[i], "-dop") == 0) {
            forceDoP = 1;
        } else if (strcmp(argv[i], "-test") == 0) {
            testMode = 1;
        } else if (strcmp(argv[i], "-help") == 0 || strcmp(argv[i], "-h") == 0) {
            printf("ASIO DSD Output Test Program\n\n");
            printf("Usage:\n");
            printf("  asiotest.exe                           - List ASIO devices\n");
            printf("  asiotest.exe -device <name>            - Select ASIO device\n");
            printf("  asiotest.exe -device <name> -file <path> - Play DSD file\n");
            printf("  asiotest.exe -device <name> -dop       - Force DoP mode\n");
            printf("  asiotest.exe -device <name> -test      - Test silence output\n");
            printf("\nSupported formats: DSF (DSD64/128/256)\n");
            return 0;
        }
    }
    
    if (!deviceName) {
        printf("Listing ASIO devices...\n\n");
        if (listAsioDevices() < 0) {
            return 1;
        }
        printf("\nUse -device <name> to select a device.\n");
        return 0;
    }
    
    printf("Initializing ASIO device: %s\n\n", deviceName);
    if (initAsioDevice(deviceName) < 0) {
        return 1;
    }
    
    if (forceDoP) {
        g_asio.useDoP = 1;
    }
    
    if (testMode) {
        printf("\nTest mode: Outputting silence for 5 seconds...\n");
        if (startAsioPlayback(2) < 0) {
            deinitAsio();
            return 1;
        }
        Sleep(5000);
        stopAsioPlayback();
    } else if (filePath) {
        printf("\nLoading DSD file: %s\n", filePath);
        if (loadDsdFile(filePath) < 0) {
            deinitAsio();
            return 1;
        }
        
        printf("Starting playback...\n\n");
        if (startAsioPlayback(g_dsd.channels) < 0) {
            closeDsdFile();
            deinitAsio();
            return 1;
        }
        
        printf("Playing... (Press Ctrl+C to stop)\n\n");
        while (g_asio.playing) {
            Sleep(100);
            MSG msg;
            while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
                TranslateMessage(&msg);
                DispatchMessage(&msg);
            }
        }
        
        closeDsdFile();
    } else {
        printf("No file specified. Use -file <path> to play a DSD file.\n");
    }
    
    deinitAsio();
    printf("\nDone.\n");
    return 0;
}

#else
int main() {
    fprintf(stderr, "ASIO is only supported on Windows\n");
    return 1;
}
#endif