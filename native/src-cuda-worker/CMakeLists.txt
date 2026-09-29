cmake_minimum_required(VERSION 3.20)

project(echo_src_cuda_worker LANGUAGES CXX)

include(CheckLanguage)
check_language(CUDA)

set(ECHO_SRC_CUDA_WORKER_SOURCES
  src/main.cpp
)

if(CMAKE_CUDA_COMPILER)
  enable_language(CUDA)
  list(APPEND ECHO_SRC_CUDA_WORKER_SOURCES src/cuda_fir.cu)
else()
  list(APPEND ECHO_SRC_CUDA_WORKER_SOURCES src/cuda_fir_stub.cpp)
endif()

add_executable(echo-src-cuda-worker
  ${ECHO_SRC_CUDA_WORKER_SOURCES}
)

target_compile_features(echo-src-cuda-worker PRIVATE cxx_std_17)

if(CMAKE_CUDA_COMPILER)
  find_package(CUDAToolkit REQUIRED)
  target_compile_definitions(echo-src-cuda-worker PRIVATE ECHO_SRC_CUDA_WORKER_HAS_CUDA=1)
  target_link_libraries(echo-src-cuda-worker PRIVATE CUDA::cudart)
  set_target_properties(echo-src-cuda-worker PROPERTIES
    CUDA_STANDARD 17
    CUDA_STANDARD_REQUIRED ON
    CUDA_SEPARABLE_COMPILATION ON
  )
else()
  message(WARNING "CUDA compiler was not found. echo-src-cuda-worker will build without CUDA FIR support.")
endif()

if(MSVC)
  target_compile_options(echo-src-cuda-worker PRIVATE
    $<$<COMPILE_LANGUAGE:CXX>:/W4 /permissive- /EHsc /MP>
    $<$<COMPILE_LANGUAGE:CUDA>:-Xcompiler=/W3>
  )
else()
  target_compile_options(echo-src-cuda-worker PRIVATE
    $<$<COMPILE_LANGUAGE:CXX>:-Wall -Wextra -Wpedantic>
    $<$<COMPILE_LANGUAGE:CUDA>:-Xcompiler=-Wall>
  )
endif()
