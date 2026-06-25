/*
 *  Copyright (c) 2003-2010, Mark Borgerding. All rights reserved.
 *  This file is part of KISS FFT - https://github.com/mborgerding/kissfft
 *
 *  SPDX-License-Identifier: BSD-3-Clause
 *  See COPYING file for more information.
 */

#ifndef KISS_FFT_H
#define KISS_FFT_H

#include <stdlib.h>
#include <stdio.h>
#include <math.h>
#include <string.h>

#ifdef KISS_FFT_SHARED
# ifdef _WIN32
#  ifdef KISS_FFT_BUILD
#   define KISS_FFT_API __declspec(dllexport)
#  else
#   define KISS_FFT_API __declspec(dllimport)
#  endif
# else
#  define KISS_FFT_API __attribute__ ((visibility ("default")))
# endif
#else
# define KISS_FFT_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

#ifdef USE_SIMD
#ifdef HAVE_LASX
# include <lasxintrin.h>
# define kiss_fft_scalar __m256
# ifndef KISS_FFT_MALLOC
#  define KISS_FFT_MALLOC(nbytes) aligned_alloc(32, KISS_FFT_ALIGN_SIZE_UP(nbytes))
#  define KISS_FFT_ALIGN_CHECK(ptr)
#  define KISS_FFT_ALIGN_SIZE_UP(size) ((size + 31UL) & ~0x1FUL)
# endif
# ifndef KISS_FFT_FREE
#  define KISS_FFT_FREE free
# endif
#elif defined(HAVE_LSX)
# include <lsxintrin.h>
# define kiss_fft_scalar __m128
# ifndef KISS_FFT_MALLOC
#  define KISS_FFT_MALLOC(nbytes) aligned_alloc(16, KISS_FFT_ALIGN_SIZE_UP(nbytes))
#  define KISS_FFT_ALIGN_CHECK(ptr)
#  define KISS_FFT_ALIGN_SIZE_UP(size) ((size + 15UL) & ~0xFUL)
# endif
# ifndef KISS_FFT_FREE
#  define KISS_FFT_FREE free
# endif
#else
# include <xmmintrin.h>
# define kiss_fft_scalar __m128
# ifndef KISS_FFT_MALLOC
#  define KISS_FFT_MALLOC(nbytes) _mm_malloc(nbytes,16)
#  define KISS_FFT_ALIGN_CHECK(ptr)
#  define KISS_FFT_ALIGN_SIZE_UP(size) ((size + 15UL) & ~0xFUL)
# endif
# ifndef KISS_FFT_FREE
#  define KISS_FFT_FREE _mm_free
# endif
#endif
#else
# define KISS_FFT_ALIGN_CHECK(ptr)
# define KISS_FFT_ALIGN_SIZE_UP(size) (size)
# ifndef KISS_FFT_MALLOC
#  define KISS_FFT_MALLOC malloc
# endif
# ifndef KISS_FFT_FREE
#  define KISS_FFT_FREE free
# endif
#endif

#ifdef FIXED_POINT
# include <stdint.h>
# if (FIXED_POINT == 32)
#  define kiss_fft_scalar int32_t
# else
#  define kiss_fft_scalar int16_t
# endif
#else
# ifndef kiss_fft_scalar
#  define kiss_fft_scalar float
# endif
#endif

typedef struct {
    kiss_fft_scalar r;
    kiss_fft_scalar i;
} kiss_fft_cpx;

typedef struct kiss_fft_state* kiss_fft_cfg;

kiss_fft_cfg KISS_FFT_API kiss_fft_alloc(int nfft, int inverse_fft, void *mem, size_t *lenmem);
void KISS_FFT_API kiss_fft(kiss_fft_cfg cfg, const kiss_fft_cpx *fin, kiss_fft_cpx *fout);
void KISS_FFT_API kiss_fft_stride(kiss_fft_cfg cfg, const kiss_fft_cpx *fin, kiss_fft_cpx *fout, int fin_stride);
#define kiss_fft_free KISS_FFT_FREE
void KISS_FFT_API kiss_fft_cleanup(void);
int KISS_FFT_API kiss_fft_next_fast_size(int n);
#define kiss_fftr_next_fast_size_real(n) \
    (kiss_fft_next_fast_size(((n)+1)>>1)<<1)

#ifdef __cplusplus
}
#endif

#endif
