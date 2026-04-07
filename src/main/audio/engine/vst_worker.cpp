/*
 * vst-worker.cpp
 *
 * 真正的“零依赖” VST2 宿主。
 * 完全不依赖几十MB的 Steinberg SDK，直接通过底层内存结构 (ABI) 与 VST 进行通信。
 * 该程序接收交错(Interleaved)的 PCM 音频，并在内部解交错后交给 VST 处理，再交错输出。
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#include <io.h>
#include <fcntl.h>
#endif

// ==========================================
// 1. 魔法：徒手定义 VST 2.4 底层内存结构
// ==========================================
#pragma pack(push, 8)
struct AEffect {
    int magic; // 必须是 'VstP'
    intptr_t (*dispatcher)(AEffect*, int, int, intptr_t, void*, float);
    void (*process)(AEffect*, float**, float**, int);
    void (*setParameter)(AEffect*, int, float);
    float (*getParameter)(AEffect*, int);
    int numPrograms;
    int numParams;
    int numInputs;
    int numOutputs;
    int flags;
    void* resvd1;
    void* resvd2;
    int initialDelay;
    int realQualities;
    int offQualities;
    float ioRatio;
    void* object;
    void* user;
    int uniqueID;
    int version;
    void (*processReplacing)(AEffect*, float**, float**, int);
    void (*processDoubleReplacing)(AEffect*, double**, double**, int);
    char future[56];
};
#pragma pack(pop)

// 宿主回调函数 (给插件用来问我们：宿主叫什么？支持什么特性？)
typedef intptr_t (*audioMasterCallback)(AEffect*, int, int, intptr_t, void*, float);
typedef AEffect* (*vstPluginFuncPtr)(audioMasterCallback);

intptr_t hostCallback(AEffect* effect, int opcode, int index, intptr_t value, void* ptr, float opt) {
    if (opcode == 0) return 2400; // effGetVersion (2.4)
    return 0; // 其他特性暂不实现
}

// VST Opcode
#define effOpen 0
#define effClose 1
#define effSetSampleRate 24
#define effSetBlockSize 25
#define effMainsChanged 51

// ==========================================
// 2. 核心主程序
// ==========================================
int main(int argc, char** argv) {
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif

    const char* pluginPath = NULL;
    float sampleRate = 44100.0f;
    
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--plugin") == 0 && i + 1 < argc) pluginPath = argv[++i];
        if (strcmp(argv[i], "--sample-rate") == 0 && i + 1 < argc) sampleRate = (float)atof(argv[++i]);
    }

    if (!pluginPath) {
        fprintf(stderr, "[vst-worker] Error: No --plugin specified.\n");
        return 1;
    }

#ifdef _WIN32
    // A. 加载 DLL
    HMODULE hLib = LoadLibraryA(pluginPath);
    if (!hLib) {
        fprintf(stderr, "[vst-worker] Error: Failed to load DLL %s\n", pluginPath);
        return 2;
    }

    // B. 获取 VST 入口点
    vstPluginFuncPtr mainEntryPoint = (vstPluginFuncPtr)GetProcAddress(hLib, "VSTPluginMain");
    if (!mainEntryPoint) mainEntryPoint = (vstPluginFuncPtr)GetProcAddress(hLib, "main");
    if (!mainEntryPoint) {
        fprintf(stderr, "[vst-worker] Error: Could not find VST entry point in DLL.\n");
        return 3;
    }

    // C. 初始化插件实例
    AEffect* plugin = mainEntryPoint(hostCallback);
    if (!plugin || plugin->magic != 0x56737450) { // 0x56737450 是 'VstP' 的 ASCII 码
        fprintf(stderr, "[vst-worker] Error: Not a valid VST2 plugin (magic mismatch).\n");
        return 4;
    }

    fprintf(stderr, "[vst-worker] Loaded VST! numInputs: %d, numOutputs: %d\n", plugin->numInputs, plugin->numOutputs);

    // D. 握手与设置环境
    plugin->dispatcher(plugin, effOpen, 0, 0, NULL, 0.0f);
    plugin->dispatcher(plugin, effSetSampleRate, 0, 0, NULL, sampleRate);
    plugin->dispatcher(plugin, effSetBlockSize, 0, 512, NULL, 0.0f);
    plugin->dispatcher(plugin, effMainsChanged, 0, 1, NULL, 0.0f); // Resume 工作引擎

    // 准备音频内存区
    int blockFrames = 512;
    int channels = 2; // 只处理立体声
    
    float* inL = (float*)malloc(blockFrames * sizeof(float));
    float* inR = (float*)malloc(blockFrames * sizeof(float));
    float* outL = (float*)malloc(blockFrames * sizeof(float));
    float* outR = (float*)malloc(blockFrames * sizeof(float));
    float* inputs[2] = { inL, inR };
    float* outputs[2] = { outL, outR };

    // 处理来自 Node.js 的交错数据 (L, R, L, R...)
    float buffer[1024]; // 512 帧 * 2 声道 = 1024 个浮点数
    
    // ==========================================
    // 3. 实时处理循环
    // ==========================================
    while (true) {
        size_t bytesRead = fread(buffer, 1, sizeof(buffer), stdin);
        if (bytesRead == 0) break; // 管道断开，结束循环

        int frames = bytesRead / (channels * sizeof(float));

        // [前处理]：把 L R L R 拆分（解交错）放到独立的通道阵列里，因为 VST 要求分层输入
        for (int i = 0; i < frames; i++) {
            inL[i] = buffer[i * 2];
            inR[i] = buffer[i * 2 + 1];
            outL[i] = 0.0f;
            outR[i] = 0.0f;
        }

        // [交由 VST 处理]
        if (plugin->processReplacing && plugin->numOutputs > 0) {
            plugin->processReplacing(plugin, inputs, outputs, frames);
        }

        // [后处理]：把分层输出合并（交错），还回给 Node.js
        for (int i = 0; i < frames; i++) {
            buffer[i * 2] = outL[i];
            // 如果插件是单声道，把左声道复制到右声道
            buffer[i * 2 + 1] = (plugin->numOutputs > 1) ? outR[i] : outL[i]; 
        }

        fwrite(buffer, 1, frames * channels * sizeof(float), stdout);
        fflush(stdout);
    }

    // 结束与清理
    plugin->dispatcher(plugin, effMainsChanged, 0, 0, NULL, 0.0f); // 挂起 VST
    plugin->dispatcher(plugin, effClose, 0, 0, NULL, 0.0f);
    FreeLibrary(hLib);

    free(inL); free(inR); free(outL); free(outR);
#endif

    return 0;
}
