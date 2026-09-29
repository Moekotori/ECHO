{
  "targets": [
    {
      "target_name": "echo-taskbar-thumbnail-helper",
      "sources": ["src/main.cpp"],
      "include_dirs": ["<!(node -p \"require('node-addon-api').include_dir\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": [
        "NOMINMAX",
        "WIN32_LEAN_AND_MEAN",
        "UNICODE",
        "_UNICODE",
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "libraries": ["dwmapi.lib", "gdi32.lib", "ole32.lib", "shell32.lib", "user32.lib"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/permissive-", "/W4"],
          "ExceptionHandling": 0
        }
      }
    }
  ]
}
