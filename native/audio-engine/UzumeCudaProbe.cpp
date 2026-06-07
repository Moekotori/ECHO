#include "UzumeGpuBackend.h"

namespace echo
{
UzumeGpuBackendProbe probeUzumeGpuBackend()
{
    return {
        false,
        false,
        false,
        "cpu-reference",
        "cuda-disabled",
        "cuda-disabled",
        nullptr,
        0,
        0,
        0,
    };
}

UzumeGpuPlaybackLimiterStatus prepareUzumeGpuPlaybackSafetyLimiter(int)
{
    return {};
}

UzumeGpuLimiterResult processUzumeGpuPreparedPlaybackSafetyLimiter(float*, int)
{
    return {};
}

UzumeGpuPlaybackLimiterStatus prepareUzumeGpuPlaybackPlanarSafetyLimiter(int, int)
{
    return {};
}

UzumeGpuLimiterResult processUzumeGpuPreparedPlaybackPlanarSafetyLimiter(float* const*, int, int)
{
    return {};
}

UzumeGpuLimiterResult processUzumeGpuSafetyLimiter(float*, int)
{
    return {};
}

UzumeGpuLimiterResult processUzumeGpuFusedGainLimiter(float*, int, float)
{
    return {};
}

UzumeGpuPlaybackStereoMatrixStatus prepareUzumeGpuPlaybackStereoMatrixLimiter(int)
{
    return {};
}

UzumeGpuLimiterResult processUzumeGpuPreparedPlaybackStereoMatrixLimiter(float*, float*, int, const UzumeGpuStereoMatrix&)
{
    return {};
}

UzumeGpuLimiterResult processUzumeGpuStereoMatrixLimiter(float*, float*, int, const UzumeGpuStereoMatrix&)
{
    return {};
}

UzumeGpuLimiterResult processUzumeGpuPreparedPlaybackStereoMatrix(float*, float*, int, const UzumeGpuStereoMatrix&)
{
    return {};
}

UzumeGpuLimiterResult processUzumeGpuStereoMatrix(float*, float*, int, const UzumeGpuStereoMatrix&)
{
    return {};
}

UzumeGpuFftRoundtripResult processUzumeGpuFftRoundtrip(float*, int)
{
    return {};
}

UzumeGpuFftConvolutionPrepareStatus prepareUzumeGpuPlaybackFftConvolution(int, int)
{
    return {};
}

UzumeGpuFftConvolutionResult processUzumeGpuPreparedPlaybackFftConvolution(float*, const float*, int, int)
{
    return {};
}

UzumeGpuFftConvolutionResult processUzumeGpuFftConvolution(float*, const float*, int, int)
{
    return {};
}

UzumeGpuFftConvolutionPrepareStatus prepareUzumeGpuPlaybackStreamingFftConvolution(int, int)
{
    return {};
}

void resetUzumeGpuPlaybackStreamingFftConvolution()
{
}

UzumeGpuFftConvolutionResult processUzumeGpuPreparedPlaybackStreamingFftConvolution(float*, const float*, int, int)
{
    return {};
}
} // namespace echo
