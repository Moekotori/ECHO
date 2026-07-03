cmake_minimum_required(VERSION 3.22)

project(echo_taskbar_thumbnail_helper VERSION 0.1.0 LANGUAGES CXX)

# cmake-js injects CMAKE_JS_INC (node + node-api headers) and CMAKE_JS_LIB
# (the import lib to link the Node/Electron runtime against). It also sets the
# output suffix to .node via CMAKE_JS_VERSION being defined.

add_library(echo-taskbar-thumbnail-helper SHARED
  src/main.cpp
  ${CMAKE_JS_SRC}
)

set_target_properties(echo-taskbar-thumbnail-helper PROPERTIES
  PREFIX ""
  SUFFIX ".node"
)

target_compile_features(echo-taskbar-thumbnail-helper PRIVATE cxx_std_20)

target_compile_definitions(echo-taskbar-thumbnail-helper PRIVATE
  NOMINMAX
  WIN32_LEAN_AND_MEAN
  UNICODE
  _UNICODE
  # node-addon-api: we do not use C++ exceptions in this addon.
  NAPI_DISABLE_CPP_EXCEPTIONS
  NODE_ADDON_API_DISABLE_DEPRECATED
)

if (MSVC)
  target_compile_options(echo-taskbar-thumbnail-helper PRIVATE /permissive- /W4)
endif()

# Node / N-API headers from cmake-js.
target_include_directories(echo-taskbar-thumbnail-helper PRIVATE
  ${CMAKE_JS_INC}
  ${NODE_ADDON_API_INC}
)

target_link_libraries(echo-taskbar-thumbnail-helper PRIVATE
  ${CMAKE_JS_LIB}
  dwmapi
  gdi32
  user32
  comctl32
)

# On Windows, cmake-js provides a delay-load hook so the addon can load into
# either node.exe or electron.exe. CMAKE_JS_SRC carries that hook source.
if (MSVC AND CMAKE_JS_NODELIB_DEF AND CMAKE_JS_NODELIB_TARGET)
  # Generate the node.lib import library for the correct architecture.
  execute_process(COMMAND ${CMAKE_AR} /def:${CMAKE_JS_NODELIB_DEF}
    /out:${CMAKE_JS_NODELIB_TARGET} ${CMAKE_STATIC_LINKER_FLAGS})
endif()
