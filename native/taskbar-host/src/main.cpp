// echo-taskbar-host.exe
//
// A pure Win32 + Direct2D taskbar mini player.
// Layout: [cover] [title/artist] [prev play next] [lyrics...]
//
// IPC: JSON over stdio.
//   Input: {"type":"state","title":"...","artist":"...","playing":true,"position":12.5,"duration":180.0,"coverPath":"C:\\...","lyrics":"..."}
//          {"type":"show"} / {"type":"hide"} / {"type":"quit"}
//   Output: {"type":"click","action":"playPause"|"next"|"prev"} / {"type":"doubleClick"} / {"type":"ready"}

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#include <shellscalingapi.h>
#include <windowsx.h>
#include <dwmapi.h>
#include <d2d1.h>
#include <dwrite.h>
#include <gdiplus.h>
#include <wincodec.h>
#include <shlobj.h>

#include <atomic>
#include <mutex>
#include <string>
#include <thread>
#include <cstdio>
#include <cstdlib>
#include <cwchar>
#include <iostream>
#include <cmath>
#include <vector>

#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "d2d1.lib")
#pragma comment(lib, "dwrite.lib")
#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "shcore.lib")
#pragma comment(lib, "oleacc.lib")

// Constants

static const wchar_t* kWindowClass = L"EchoTaskbarHost";
static const wchar_t* kWindowTitle = L"ECHO Taskbar Mini Player";
static const DWORD kNoExperimentalWindowBand = 0xFFFFFFFF;
static float g_dpiScale = 1.0f; // updated at startup from system DPI
static int kPreferredWidth = 360;
static int kPreferredHeight = 48;
static float kProgressHeight = 2.0f;
static float kButtonSize = 22.0f;
static float kCoverSize = 36.0f;
static float kPadding = 6.0f;
static float kTitleFontSize = 11.0f;
static float kArtistFontSize = 10.0f;
static float kLyricsFontSize = 11.0f;

// Base layout constants (at 96 DPI / 100% scale)
static const float kBaseWidth = 360.0f;
static const float kBaseHeight = 48.0f;
static const float kBaseProgressHeight = 2.0f;
static const float kBaseButtonSize = 28.0f;
static const float kBaseCoverSize = 38.0f;
static const float kBasePadding = 7.0f;
static const float kBaseTitleFontSize = 13.0f;
static const float kBaseArtistFontSize = 11.0f;
static const float kBaseLyricsFontSize = 12.0f;

// Update all DPI-scaled layout constants from g_dpiScale
static void applyDpiScale() {
  kPreferredWidth = static_cast<int>(kBaseWidth * g_dpiScale);
  kPreferredHeight = static_cast<int>(kBaseHeight * g_dpiScale);
  kProgressHeight = kBaseProgressHeight * g_dpiScale;
  kButtonSize = kBaseButtonSize * g_dpiScale;
  kCoverSize = kBaseCoverSize * g_dpiScale;
  kPadding = kBasePadding * g_dpiScale;
  kTitleFontSize = kBaseTitleFontSize * g_dpiScale;
  kArtistFontSize = kBaseArtistFontSize * g_dpiScale;
  kLyricsFontSize = kBaseLyricsFontSize * g_dpiScale;
}

static void logHostMsg(const char* msg) {
  wchar_t tempPath[MAX_PATH] = {};
  GetTempPathW(MAX_PATH, tempPath);
  wcscat_s(tempPath, L"echo-taskbar-host.log");

  FILE* f = nullptr;
  _wfopen_s(&f, tempPath, L"a, ccs=UTF-8");
  if (f) {
    SYSTEMTIME st = {};
    GetLocalTime(&st);
    fwprintf(f, L"[%02u:%02u:%02u.%03u] %S\n", st.wHour, st.wMinute, st.wSecond, st.wMilliseconds, msg);
    fclose(f);
  }
}

static DWORD resolveExperimentalWindowBand() {
  size_t requiredLength = 0;
  _wgetenv_s(&requiredLength, nullptr, 0, L"ECHO_TASKBAR_WINDOW_BAND");
  if (requiredLength <= 1) {
    return kNoExperimentalWindowBand;
  }

  std::vector<wchar_t> env(requiredLength);
  _wgetenv_s(&requiredLength, env.data(), env.size(), L"ECHO_TASKBAR_WINDOW_BAND");
  const wchar_t* valueText = env.data();
  if (!valueText[0] || _wcsicmp(valueText, L"0") == 0 || _wcsicmp(valueText, L"off") == 0) {
    return kNoExperimentalWindowBand;
  }

  if (_wcsicmp(valueText, L"uiaccess") == 0) return 2;
  if (_wcsicmp(valueText, L"immersive-mogo") == 0 || _wcsicmp(valueText, L"mogo") == 0) return 6;
  if (_wcsicmp(valueText, L"immersive-search") == 0 || _wcsicmp(valueText, L"search") == 0) return 13;
  if (_wcsicmp(valueText, L"system-tools") == 0 || _wcsicmp(valueText, L"tools") == 0) return 16;
  if (_wcsicmp(valueText, L"above-lock") == 0) return 18;

  wchar_t* end = nullptr;
  unsigned long parsedValue = wcstoul(valueText, &end, 10);
  if (end && *end == L'\0' && parsedValue <= 0xFFFFFFFEUL) {
    return static_cast<DWORD>(parsedValue);
  }

  logHostMsg("Ignoring invalid ECHO_TASKBAR_WINDOW_BAND value");
  fprintf(stderr, "[taskbar-host] Ignoring invalid ECHO_TASKBAR_WINDOW_BAND value\n");
  return kNoExperimentalWindowBand;
}

struct HostWindowBounds {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
};

static int scaledMargin() {
  return static_cast<int>(8 * g_dpiScale);
}

static bool isWindowsTaskbarLeftAligned() {
  DWORD taskbarAlignment = 1;
  DWORD dataSize = sizeof(taskbarAlignment);
  LSTATUS status = RegGetValueW(
    HKEY_CURRENT_USER,
    L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced",
    L"TaskbarAl",
    RRF_RT_REG_DWORD,
    nullptr,
    &taskbarAlignment,
    &dataSize);

  return status == ERROR_SUCCESS && taskbarAlignment == 0;
}

static bool rectIntersectsMonitor(const RECT& rect, const RECT& monitor) {
  return rect.right > monitor.left && rect.left < monitor.right &&
    rect.bottom > monitor.top && rect.top < monitor.bottom;
}

static bool getPrimaryTrayNotifyRect(RECT& rect) {
  HWND taskbar = FindWindowW(L"Shell_TrayWnd", nullptr);
  if (!taskbar) return false;

  HWND tray = FindWindowExW(taskbar, nullptr, L"TrayNotifyWnd", nullptr);
  if (!tray) return false;

  RECT trayRect = {};
  if (!GetWindowRect(tray, &trayRect)) return false;
  if (trayRect.right <= trayRect.left || trayRect.bottom <= trayRect.top) return false;

  rect = trayRect;
  return true;
}

static HostWindowBounds calculateHostWindowBounds(HWND hwndForMonitor) {
  HMONITOR hmon = hwndForMonitor
    ? MonitorFromWindow(hwndForMonitor, MONITOR_DEFAULTTOPRIMARY)
    : MonitorFromPoint(POINT{ 0, 0 }, MONITOR_DEFAULTTOPRIMARY);
  MONITORINFO mi = {};
  mi.cbSize = sizeof(mi);
  GetMonitorInfoW(hmon, &mi);

  int taskbarHeight = mi.rcMonitor.bottom - mi.rcWork.bottom;
  bool taskbarOnBottom = taskbarHeight >= 24;
  bool taskbarOnTop = (mi.rcWork.top - mi.rcMonitor.top) >= 24;
  bool taskbarOnLeft = (mi.rcWork.left - mi.rcMonitor.left) >= 24;
  bool taskbarOnRight = (mi.rcMonitor.right - mi.rcWork.right) >= 24;
  const int margin = scaledMargin();

  HostWindowBounds bounds;
  if (taskbarOnBottom) {
    if (taskbarHeight < 24) taskbarHeight = 48;
    bounds.x = mi.rcMonitor.left + margin;
    bounds.y = mi.rcWork.bottom;
    bounds.width = kPreferredWidth;
    bounds.height = taskbarHeight;

    RECT trayRect = {};
    if (isWindowsTaskbarLeftAligned() && getPrimaryTrayNotifyRect(trayRect) && rectIntersectsMonitor(trayRect, mi.rcMonitor)) {
      const int minX = mi.rcMonitor.left + margin;
      const int maxX = mi.rcMonitor.right - bounds.width - margin;
      int trayAlignedX = trayRect.left - bounds.width;
      if (trayAlignedX < minX) trayAlignedX = minX;
      if (trayAlignedX > maxX) trayAlignedX = maxX;
      bounds.x = trayAlignedX;
    }
  } else if (taskbarOnTop) {
    int taskbarH = mi.rcWork.top - mi.rcMonitor.top;
    if (taskbarH < 24) taskbarH = 48;
    bounds.x = mi.rcMonitor.left + margin;
    bounds.y = mi.rcMonitor.top;
    bounds.width = kPreferredWidth;
    bounds.height = taskbarH;
  } else if (taskbarOnRight) {
    int taskbarW = mi.rcMonitor.right - mi.rcWork.right;
    if (taskbarW < 24) taskbarW = 72;
    bounds.x = mi.rcWork.right;
    bounds.y = mi.rcMonitor.bottom - kPreferredHeight - margin;
    bounds.width = taskbarW;
    bounds.height = kPreferredHeight;
  } else if (taskbarOnLeft) {
    int taskbarW = mi.rcWork.left - mi.rcMonitor.left;
    if (taskbarW < 24) taskbarW = 72;
    bounds.x = mi.rcMonitor.left;
    bounds.y = mi.rcMonitor.bottom - kPreferredHeight - margin;
    bounds.width = taskbarW;
    bounds.height = kPreferredHeight;
  } else {
    if (taskbarHeight < 24) taskbarHeight = 48;
    bounds.x = mi.rcMonitor.left + margin;
    bounds.y = mi.rcWork.bottom;
    bounds.width = kPreferredWidth;
    bounds.height = taskbarHeight;
  }

  return bounds;
}
static const UINT_PTR kPollTimerId = 2;
static const UINT kPollIntervalMs = 200;
static const UINT kRenderIntervalMs = 16;
static const UINT_PTR kColorTimerId = 3;
static const UINT kColorIntervalMs = 5000; // resample taskbar color every 5s

static D2D1_COLOR_F g_backgroundColor = D2D1::ColorF(0x1A1A1A, 1.0f); // dynamic, sampled from taskbar
static D2D1_COLOR_F g_textColor = D2D1::ColorF(0xF0F0F0, 1.0f);
static D2D1_COLOR_F g_subTextColor = D2D1::ColorF(0xA0A0A0, 1.0f);
static D2D1_COLOR_F g_lyricsColor = D2D1::ColorF(0xFFFFFF, 1.0f);
static bool g_isLightMode = false;
static const D2D1_COLOR_F kProgressColor = D2D1::ColorF(0x4A90D9, 1.0f);
static D2D1_COLOR_F g_progressBackColor = D2D1::ColorF(0x404040, 1.0f);
static D2D1_COLOR_F g_buttonHoverColor = D2D1::ColorF(0xFFFFFF, 0.15f);
static D2D1_COLOR_F g_coverPlaceholderColor = D2D1::ColorF(0x333333, 1.0f);

// State

struct PlayerState {
  std::wstring title = L"No Track";
  std::wstring artist = L"";
  std::wstring lyrics = L"";
  std::wstring coverPath = L"";
  bool playing = false;
  double position = 0.0;
  double duration = 0.0;
};

static std::mutex g_stateMutex;
static PlayerState g_state;
static std::atomic<bool> g_running{true};
static std::thread g_animationThread;
static std::atomic<bool> g_visible{true};
static bool g_isFullscreen = false; // true when foreground app is fullscreen
static HWND g_hwnd = nullptr;
static HostWindowBounds g_lastBounds = {};
static bool g_lastBoundsValid = false;

// Direct2D resources
static ID2D1Factory* g_d2dFactory = nullptr;
static ID2D1HwndRenderTarget* g_renderTarget = nullptr;
static IDWriteFactory* g_writeFactory = nullptr;
static IDWriteTextFormat* g_titleFormat = nullptr;
static IDWriteTextFormat* k_artistFormat = nullptr;
static IDWriteTextFormat* g_lyricsFormat = nullptr;
static IDWriteTextLayout* g_lyricsLayout = nullptr;
static IDWriteRenderingParams* g_textRenderingParams = nullptr;
static std::wstring g_cachedLyricsLayoutText;
static float g_cachedLyricsTextWidth = 0.0f;
static float g_cachedLyricsDpiScale = 0.0f;
static std::atomic<bool> g_lyricsShouldAnimate{false};

static HRESULT createUiTextFormat(DWRITE_FONT_WEIGHT weight, float fontSize, IDWriteTextFormat** format) {
  if (!g_writeFactory || !format) return E_INVALIDARG;

  *format = nullptr;
  const wchar_t* fontFamilies[] = {
    L"Microsoft YaHei UI",
    L"Segoe UI Variable Text",
    L"Segoe UI",
  };

  HRESULT hr = E_FAIL;
  for (const wchar_t* family : fontFamilies) {
    hr = g_writeFactory->CreateTextFormat(
      family, nullptr, weight, DWRITE_FONT_STYLE_NORMAL,
      DWRITE_FONT_STRETCH_NORMAL, fontSize, L"zh-CN", format);
    if (SUCCEEDED(hr) && *format) return hr;
  }

  return hr;
}

// Recreate text formats with updated font sizes (called on DPI change)
static void recreateTextFormats() {
  if (!g_writeFactory) return;
  if (g_textRenderingParams) { g_textRenderingParams->Release(); g_textRenderingParams = nullptr; }
  if (g_lyricsLayout) { g_lyricsLayout->Release(); g_lyricsLayout = nullptr; }
  g_cachedLyricsLayoutText.clear();
  g_cachedLyricsTextWidth = 0.0f;
  g_cachedLyricsDpiScale = 0.0f;
  g_lyricsShouldAnimate = false;
  if (g_titleFormat) { g_titleFormat->Release(); g_titleFormat = nullptr; }
  if (k_artistFormat) { k_artistFormat->Release(); k_artistFormat = nullptr; }
  if (g_lyricsFormat) { g_lyricsFormat->Release(); g_lyricsFormat = nullptr; }

  createUiTextFormat(DWRITE_FONT_WEIGHT_MEDIUM, kTitleFontSize, &g_titleFormat);
  createUiTextFormat(DWRITE_FONT_WEIGHT_NORMAL, kArtistFontSize, &k_artistFormat);
  createUiTextFormat(DWRITE_FONT_WEIGHT_NORMAL, kLyricsFontSize, &g_lyricsFormat);
}

static void applyTextRenderingSettings() {
  if (!g_renderTarget) return;

  if (!g_textRenderingParams && g_writeFactory) {
    g_writeFactory->CreateCustomRenderingParams(
      1.0f, 0.0f, 1.0f,
      DWRITE_PIXEL_GEOMETRY_FLAT,
      DWRITE_RENDERING_MODE_NATURAL_SYMMETRIC,
      &g_textRenderingParams);
  }

  g_renderTarget->SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
  if (g_textRenderingParams) g_renderTarget->SetTextRenderingParams(g_textRenderingParams);
}

static ID2D1SolidColorBrush* g_textBrush = nullptr;
static ID2D1SolidColorBrush* g_subTextBrush = nullptr;
static ID2D1SolidColorBrush* g_lyricsBrush = nullptr;
static ID2D1SolidColorBrush* g_progressBrush = nullptr;
static ID2D1SolidColorBrush* g_progressBackBrush = nullptr;
static ID2D1SolidColorBrush* g_buttonHoverBrush = nullptr;
static ID2D1SolidColorBrush* g_coverPlaceholderBrush = nullptr;

// Cover bitmap
static ID2D1Bitmap* g_coverBitmap = nullptr;
static std::wstring g_loadedCoverPath;
static ULONG_PTR g_gdiplusToken = 0;

// Scrolling state
static double g_scrollTime = 0.0; // accumulated time in seconds for scroll animation
static std::wstring g_lastLyricsText; // track lyrics text changes to reset scroll
static ULONGLONG g_lastRenderTick = 0;

static float dpiScale() {
  return g_dpiScale > 0.0f ? g_dpiScale : 1.0f;
}

static float snapPixel(float value) {
  float scale = dpiScale();
  return floorf(value * scale + 0.5f) / scale;
}

static float snapSubpixel(float value) {
  float scale = dpiScale() * 3.0f;
  return floorf(value * scale + 0.5f) / scale;
}

static int g_hoveredButton = -1;

// IPC helpers

static void sendJson(const std::string& json) {
  std::string line = json + "\n";
  HANDLE hStdout = GetStdHandle(STD_OUTPUT_HANDLE);
  WriteFile(hStdout, line.c_str(), static_cast<DWORD>(line.size()), nullptr, nullptr);
  FlushFileBuffers(hStdout);
}

static std::wstring utf8ToWide(const std::string& s) {
  if (s.empty()) return {};
  int len = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
  if (len <= 0) return {};
  std::wstring wide(len - 1, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, wide.data(), len);
  return wide;
}

static std::string extractJsonString(const std::string& json, const std::string& key) {
  std::string needle = "\"" + key + "\":\"";
  size_t pos = json.find(needle);
  if (pos == std::string::npos) return "";
  pos += needle.size();
  std::string result;
  while (pos < json.size() && json[pos] != '"') {
    if (json[pos] == '\\' && pos + 1 < json.size()) {
      pos++;
      switch (json[pos]) {
        case '"': result += '"'; break;
        case '\\': result += '\\'; break;
        case 'n': result += '\n'; break;
        case 'r': result += '\r'; break;
        case 't': result += '\t'; break;
        default: result += json[pos]; break;
      }
    } else {
      result += json[pos];
    }
    pos++;
  }
  return result;
}

static bool extractJsonBool(const std::string& json, const std::string& key) {
  std::string needle = "\"" + key + "\":";
  size_t pos = json.find(needle);
  if (pos == std::string::npos) return false;
  pos += needle.size();
  while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
  return pos < json.size() && json[pos] == 't';
}

static double extractJsonNumber(const std::string& json, const std::string& key) {
  std::string needle = "\"" + key + "\":";
  size_t pos = json.find(needle);
  if (pos == std::string::npos) return 0.0;
  pos += needle.size();
  while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
  try {
    return std::stod(json.substr(pos));
  } catch (...) {
    return 0.0;
  }
}

// Cover bitmap loading

static void loadCoverBitmap(const std::wstring& path) {
  if (g_loadedCoverPath == path) return;
  g_loadedCoverPath = path;

  if (g_coverBitmap) { g_coverBitmap->Release(); g_coverBitmap = nullptr; }
  if (path.empty() || !g_renderTarget) return;

  // Use GDI+ to load the image (PNG/JPG/etc.)
  Gdiplus::Bitmap* bitmap = Gdiplus::Bitmap::FromFile(path.c_str());
  if (!bitmap || bitmap->GetLastStatus() != Gdiplus::Ok) {
    delete bitmap;
    return;
  }

  HBITMAP hBmp = nullptr;
  Gdiplus::Color bg(0, 0, 0);
  bitmap->GetHBITMAP(bg, &hBmp);
  delete bitmap;

  if (!hBmp) return;

  BITMAP bm;
  GetObject(hBmp, sizeof(bm), &bm);

  D2D1_SIZE_U size = D2D1::SizeU(bm.bmWidth, bm.bmHeight);
  D2D1_BITMAP_PROPERTIES props = D2D1::BitmapProperties(
    D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED));

  HRESULT hr = g_renderTarget->CreateBitmap(size, nullptr, 0, &props, &g_coverBitmap);
  if (SUCCEEDED(hr) && g_coverBitmap) {
    HDC hMemDC = CreateCompatibleDC(nullptr);
    HBITMAP hOldBmp = (HBITMAP)SelectObject(hMemDC, hBmp);

    BITMAPINFO bi = {};
    bi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bi.bmiHeader.biWidth = bm.bmWidth;
    bi.bmiHeader.biHeight = -bm.bmHeight;
    bi.bmiHeader.biPlanes = 1;
    bi.bmiHeader.biBitCount = 32;
    bi.bmiHeader.biCompression = BI_RGB;

    int pixelSize = bm.bmWidth * bm.bmHeight * 4;
    BYTE* pixels = new BYTE[pixelSize];
    GetDIBits(hMemDC, hBmp, 0, bm.bmHeight, pixels, &bi, DIB_RGB_COLORS);
    g_coverBitmap->CopyFromMemory(nullptr, pixels, bm.bmWidth * 4);
    delete[] pixels;

    SelectObject(hMemDC, hOldBmp);
    DeleteDC(hMemDC);
  }

  DeleteObject(hBmp);
}

// Taskbar color sampling

static void sampleTaskbarColor() {
  // Detect light/dark mode from registry and use matching fixed color
  // Windows 11 taskbar: dark mode ~#202020, light mode ~#F3F3F3
  DWORD appsUseLightTheme = 1;
  DWORD dataSize = sizeof(appsUseLightTheme);
  HKEY hKey;

  if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
    0, KEY_READ, &hKey) == ERROR_SUCCESS) {
    RegQueryValueExW(hKey, L"AppsUseLightTheme", nullptr, nullptr,
      reinterpret_cast<LPBYTE>(&appsUseLightTheme), &dataSize);
    RegCloseKey(hKey);
  }

  if (appsUseLightTheme == 0) {
    // Dark mode
    g_isLightMode = false;
    g_backgroundColor = D2D1::ColorF(0x202020, 1.0f);
    g_textColor = D2D1::ColorF(0xF0F0F0, 1.0f);
    g_subTextColor = D2D1::ColorF(0xA0A0A0, 1.0f);
    g_lyricsColor = D2D1::ColorF(0xFFFFFF, 1.0f);
    g_progressBackColor = D2D1::ColorF(0x404040, 1.0f);
    g_buttonHoverColor = D2D1::ColorF(0xFFFFFF, 0.15f);
    g_coverPlaceholderColor = D2D1::ColorF(0x333333, 1.0f);
  } else {
    // Light mode
    g_isLightMode = true;
    g_backgroundColor = D2D1::ColorF(0xF3F3F3, 1.0f);
    g_textColor = D2D1::ColorF(0x1A1A1A, 1.0f);
    g_subTextColor = D2D1::ColorF(0x666666, 1.0f);
    g_lyricsColor = D2D1::ColorF(0x1A1A1A, 1.0f);
    g_progressBackColor = D2D1::ColorF(0xC8C8C8, 1.0f);
    g_buttonHoverColor = D2D1::ColorF(0x000000, 0.10f);
    g_coverPlaceholderColor = D2D1::ColorF(0xDDDDDD, 1.0f);
  }

  // Update brush colors if already created
  if (g_textBrush) g_textBrush->SetColor(g_textColor);
  if (g_subTextBrush) g_subTextBrush->SetColor(g_subTextColor);
  if (g_lyricsBrush) g_lyricsBrush->SetColor(g_lyricsColor);
  if (g_progressBackBrush) g_progressBackBrush->SetColor(g_progressBackColor);
  if (g_buttonHoverBrush) g_buttonHoverBrush->SetColor(g_buttonHoverColor);
  if (g_coverPlaceholderBrush) g_coverPlaceholderBrush->SetColor(g_coverPlaceholderColor);
}

// Direct2D

static bool initD2D() {
  HRESULT hr = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, &g_d2dFactory);
  if (FAILED(hr)) return false;

  hr = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory),
                           reinterpret_cast<IUnknown**>(&g_writeFactory));
  if (FAILED(hr)) return false;

  // Initialize GDI+ for cover art loading
  Gdiplus::GdiplusStartupInput gdiplusStartupInput;
  Gdiplus::GdiplusStartup(&g_gdiplusToken, &gdiplusStartupInput, nullptr);

  RECT rc;
  GetClientRect(g_hwnd, &rc);
  D2D1_SIZE_U size = D2D1::SizeU(rc.right - rc.left, rc.bottom - rc.top);

  // The host window and all layout constants are already scaled to physical
  // pixels. Keep the D2D target at 96 DPI so Windows does not resample text.
  UINT pixelWidth = static_cast<UINT>(std::max<LONG>(1, rc.right - rc.left));
  UINT pixelHeight = static_cast<UINT>(std::max<LONG>(1, rc.bottom - rc.top));

  D2D1_RENDER_TARGET_PROPERTIES rtProps = D2D1::RenderTargetProperties(
    D2D1_RENDER_TARGET_TYPE_DEFAULT,
    D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED),
    96.0f, 96.0f);

  hr = g_d2dFactory->CreateHwndRenderTarget(
    rtProps,
    D2D1::HwndRenderTargetProperties(g_hwnd, D2D1::SizeU(pixelWidth, pixelHeight)),
    &g_renderTarget);
  if (FAILED(hr)) return false;

  applyTextRenderingSettings();
  g_renderTarget->SetAntialiasMode(D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);

  g_renderTarget->CreateSolidColorBrush(g_textColor, &g_textBrush);
  g_renderTarget->CreateSolidColorBrush(g_subTextColor, &g_subTextBrush);
  g_renderTarget->CreateSolidColorBrush(g_lyricsColor, &g_lyricsBrush);
  g_renderTarget->CreateSolidColorBrush(kProgressColor, &g_progressBrush);
  g_renderTarget->CreateSolidColorBrush(g_progressBackColor, &g_progressBackBrush);
  g_renderTarget->CreateSolidColorBrush(g_buttonHoverColor, &g_buttonHoverBrush);
  g_renderTarget->CreateSolidColorBrush(g_coverPlaceholderColor, &g_coverPlaceholderBrush);

  createUiTextFormat(DWRITE_FONT_WEIGHT_MEDIUM, kTitleFontSize, &g_titleFormat);
  createUiTextFormat(DWRITE_FONT_WEIGHT_NORMAL, kArtistFontSize, &k_artistFormat);
  createUiTextFormat(DWRITE_FONT_WEIGHT_NORMAL, kLyricsFontSize, &g_lyricsFormat);

  return true;
}

static void cleanupD2D() {
  if (g_coverBitmap) { g_coverBitmap->Release(); g_coverBitmap = nullptr; }
  if (g_gdiplusToken) { Gdiplus::GdiplusShutdown(g_gdiplusToken); g_gdiplusToken = 0; }
  if (g_titleFormat) { g_titleFormat->Release(); g_titleFormat = nullptr; }
  if (k_artistFormat) { k_artistFormat->Release(); k_artistFormat = nullptr; }
  if (g_lyricsLayout) { g_lyricsLayout->Release(); g_lyricsLayout = nullptr; }
  g_cachedLyricsLayoutText.clear();
  g_cachedLyricsTextWidth = 0.0f;
  g_cachedLyricsDpiScale = 0.0f;
  g_lyricsShouldAnimate = false;
  if (g_lyricsFormat) { g_lyricsFormat->Release(); g_lyricsFormat = nullptr; }
  if (g_textRenderingParams) { g_textRenderingParams->Release(); g_textRenderingParams = nullptr; }
  if (g_writeFactory) { g_writeFactory->Release(); g_writeFactory = nullptr; }
  if (g_coverPlaceholderBrush) { g_coverPlaceholderBrush->Release(); g_coverPlaceholderBrush = nullptr; }
  if (g_buttonHoverBrush) { g_buttonHoverBrush->Release(); g_buttonHoverBrush = nullptr; }
  if (g_progressBackBrush) { g_progressBackBrush->Release(); g_progressBackBrush = nullptr; }
  if (g_progressBrush) { g_progressBrush->Release(); g_progressBrush = nullptr; }
  if (g_lyricsBrush) { g_lyricsBrush->Release(); g_lyricsBrush = nullptr; }
  if (g_subTextBrush) { g_subTextBrush->Release(); g_subTextBrush = nullptr; }
  if (g_textBrush) { g_textBrush->Release(); g_textBrush = nullptr; }
  if (g_renderTarget) { g_renderTarget->Release(); g_renderTarget = nullptr; }
  if (g_d2dFactory) { g_d2dFactory->Release(); g_d2dFactory = nullptr; }
}

static void resizeRenderTarget() {
  if (!g_renderTarget || !g_hwnd) return;
  RECT rc;
  GetClientRect(g_hwnd, &rc);

  UINT pixelWidth = static_cast<UINT>(std::max<LONG>(1, rc.right - rc.left));
  UINT pixelHeight = static_cast<UINT>(std::max<LONG>(1, rc.bottom - rc.top));
  g_renderTarget->Resize(D2D1::SizeU(pixelWidth, pixelHeight));
  g_renderTarget->SetDpi(96.0f, 96.0f);
  applyTextRenderingSettings();
}

// Drawing

static void drawTriangle(ID2D1HwndRenderTarget* rt, const D2D1_POINT_2F pts[3], ID2D1SolidColorBrush* brush) {
  ID2D1PathGeometry* geo = nullptr;
  g_d2dFactory->CreatePathGeometry(&geo);
  if (!geo) return;
  ID2D1GeometrySink* sink = nullptr;
  geo->Open(&sink);
  if (!sink) { geo->Release(); return; }
  sink->BeginFigure(pts[0], D2D1_FIGURE_BEGIN_FILLED);
  sink->AddLine(pts[1]);
  sink->AddLine(pts[2]);
  sink->EndFigure(D2D1_FIGURE_END_CLOSED);
  sink->Close();
  sink->Release();
  rt->FillGeometry(geo, brush);
  geo->Release();
}

static void drawPlayPauseIcon(ID2D1HwndRenderTarget* rt, float cx, float cy, bool playing, ID2D1SolidColorBrush* brush) {
  float s = 1.25f * g_dpiScale; // icon scale (DPI-aware)
  if (playing) {
    D2D1_RECT_F r1 = D2D1::RectF(cx - 4*s, cy - 6*s, cx - 1*s, cy + 6*s);
    D2D1_RECT_F r2 = D2D1::RectF(cx + 1*s, cy - 6*s, cx + 4*s, cy + 6*s);
    rt->FillRectangle(r1, brush);
    rt->FillRectangle(r2, brush);
  } else {
    D2D1_POINT_2F pts[3] = {
      D2D1::Point2F(cx - 3*s, cy - 6*s),
      D2D1::Point2F(cx - 3*s, cy + 6*s),
      D2D1::Point2F(cx + 5*s, cy),
    };
    drawTriangle(rt, pts, brush);
  }
}

static void drawPrevIcon(ID2D1HwndRenderTarget* rt, float cx, float cy, ID2D1SolidColorBrush* brush) {
  float s = 1.25f * g_dpiScale;
  D2D1_RECT_F bar = D2D1::RectF(cx - 5*s, cy - 5*s, cx - 3*s, cy + 5*s);
  rt->FillRectangle(bar, brush);
  D2D1_POINT_2F pts[3] = {
    D2D1::Point2F(cx + 5*s, cy - 6*s),
    D2D1::Point2F(cx + 5*s, cy + 6*s),
    D2D1::Point2F(cx - 2*s, cy),
  };
  drawTriangle(rt, pts, brush);
}

static void drawNextIcon(ID2D1HwndRenderTarget* rt, float cx, float cy, ID2D1SolidColorBrush* brush) {
  float s = 1.25f * g_dpiScale;
  D2D1_RECT_F bar = D2D1::RectF(cx + 3*s, cy - 5*s, cx + 5*s, cy + 5*s);
  rt->FillRectangle(bar, brush);
  D2D1_POINT_2F pts[3] = {
    D2D1::Point2F(cx - 5*s, cy - 6*s),
    D2D1::Point2F(cx - 5*s, cy + 6*s),
    D2D1::Point2F(cx + 2*s, cy),
  };
  drawTriangle(rt, pts, brush);
}

// Truncate text with ellipsis to fit within maxWidth
static std::wstring truncateTextWithEllipsis(const std::wstring& text, IDWriteTextFormat* format,
  float maxWidth) {
  if (text.empty()) return text;

  // Measure full text width
  IDWriteTextLayout* layout = nullptr;
  g_writeFactory->CreateTextLayout(text.c_str(), static_cast<UINT32>(text.size()),
    format, 9999, 9999, &layout);
  if (!layout) return text;

  DWRITE_TEXT_METRICS metrics;
  layout->GetMetrics(&metrics);
  float fullWidth = metrics.widthIncludingTrailingWhitespace;
  layout->Release();

  if (fullWidth <= maxWidth) return text;

      // Binary search for the max number of chars that fits without cutting mid-word
  std::wstring ellipsis = L"\u2026";
  int lo = 1, hi = static_cast<int>(text.size());
  int best = 1;

  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    std::wstring candidate = text.substr(0, mid) + ellipsis;
    g_writeFactory->CreateTextLayout(candidate.c_str(), static_cast<UINT32>(candidate.size()),
      format, 9999, 9999, &layout);
    if (layout) {
      layout->GetMetrics(&metrics);
      float w = metrics.widthIncludingTrailingWhitespace;
      layout->Release();
      if (w <= maxWidth) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    } else {
      hi = mid - 1;
    }
  }

  return text.substr(0, best) + ellipsis;
}

static void render() {
  if (!g_renderTarget) return;

  std::lock_guard<std::mutex> lock(g_stateMutex);
  PlayerState state = g_state;

  // Reload cover if path changed
  loadCoverBitmap(state.coverPath);

  g_renderTarget->BeginDraw();

  g_renderTarget->Clear(D2D1::ColorF(0.0f, 0.0f, 0.0f, 0.0f));

  RECT rc;
  GetClientRect(g_hwnd, &rc);
  float width = static_cast<float>(rc.right - rc.left);
  float height = static_cast<float>(rc.bottom - rc.top);

  // Layout: [cover] [title/artist] [lyrics center] [buttons right]
  float x = 0.0f;

  // Cover (left)
  float coverY = snapPixel((height - kCoverSize) / 2.0f);
  float coverBottom = coverY + kCoverSize;
  D2D1_RECT_F coverRect = D2D1::RectF(x, coverY, x + kCoverSize, coverY + kCoverSize);
  if (g_coverBitmap) {
    g_renderTarget->DrawBitmap(g_coverBitmap, coverRect, 1.0f,
      D2D1_BITMAP_INTERPOLATION_MODE_LINEAR);
  } else {
    g_renderTarget->FillRectangle(coverRect, g_coverPlaceholderBrush);
  }
  float contentGap = snapPixel(kPadding * 0.6f);
  float titleTop = snapPixel(coverY - kPadding * 0.35f);
  x += kCoverSize + contentGap;

  // Buttons (right side)
  float btnAreaW = snapPixel(kButtonSize * 3 + kPadding * 2);
  float btnAreaX = snapPixel(width - btnAreaW);
  float btnY = snapPixel((height - kButtonSize) / 2.0f);
  float prevX = btnAreaX;
  float playX = btnAreaX + kButtonSize + kPadding;
  float nextX = btnAreaX + (kButtonSize + kPadding) * 2;

  // Button hover backgrounds
  for (int i = 0; i < 3; i++) {
    if (i == g_hoveredButton) {
      float bx = (i == 0) ? prevX : (i == 1) ? playX : nextX;
      D2D1_RECT_F r = D2D1::RectF(bx, btnY, bx + kButtonSize, btnY + kButtonSize);
      g_renderTarget->FillRectangle(r, g_buttonHoverBrush);
    }
  }

  drawPrevIcon(g_renderTarget, prevX + kButtonSize / 2, btnY + kButtonSize / 2, g_textBrush);
  drawPlayPauseIcon(g_renderTarget, playX + kButtonSize / 2, btnY + kButtonSize / 2, state.playing, g_textBrush);
  drawNextIcon(g_renderTarget, nextX + kButtonSize / 2, btnY + kButtonSize / 2, g_textBrush);

  // Available space between cover and buttons
  float contentLeft = x;
  float contentRight = btnAreaX - kPadding;

  if (!state.lyrics.empty() && contentRight > contentLeft + 80) {
    // With lyrics: [title top] [artist + lyrics on same line bottom]
    float contentLeft2 = contentLeft;
    float contentRight2 = contentRight;

    // Title (top, aligned with cover top area, truncated to fit)
    {
      std::wstring title = state.title.empty() ? L"No Track" : state.title;
      float titleMaxW = contentRight2 - contentLeft2;
      title = truncateTextWithEllipsis(title, g_titleFormat, titleMaxW);
      float titleLineH = kTitleFontSize * 1.35f;
      D2D1_RECT_F titleRect = D2D1::RectF(contentLeft2, titleTop, contentRight2, titleTop + titleLineH);
      g_titleFormat->SetTextAlignment(DWRITE_TEXT_ALIGNMENT_LEADING);
      g_titleFormat->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_NEAR);
      g_titleFormat->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
      g_renderTarget->DrawText(title.c_str(), static_cast<UINT32>(title.size()),
        g_titleFormat, titleRect, g_textBrush,
        D2D1_DRAW_TEXT_OPTIONS_NONE, DWRITE_MEASURING_MODE_GDI_CLASSIC);
    }

    // Artist (bottom-left, same line as lyrics)
    float artistLeft = contentLeft2;
    float artistRight = contentLeft2;
    {
      std::wstring artist = state.artist;
      // Truncate artist to 14 chars for lyrics space
      if (artist.size() > 14) {
        artist = artist.substr(0, 14) + L"\u2026";
      }
      // Measure artist width
      IDWriteTextLayout* artistLayout = nullptr;
      g_writeFactory->CreateTextLayout(artist.c_str(), static_cast<UINT32>(artist.size()),
        k_artistFormat, 9999, 9999, &artistLayout);
      float artistW = 0;
      if (artistLayout) {
        DWRITE_TEXT_METRICS m;
        artistLayout->GetMetrics(&m);
        artistW = m.widthIncludingTrailingWhitespace;
        artistLayout->Release();
      }
      artistRight = snapPixel(artistLeft + artistW + kPadding * 2);

      float artistLineHeight = kArtistFontSize * 1.4f;
      D2D1_RECT_F artistRect = D2D1::RectF(artistLeft, coverBottom - artistLineHeight, artistRight, coverBottom);
      k_artistFormat->SetTextAlignment(DWRITE_TEXT_ALIGNMENT_LEADING);
      k_artistFormat->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_NEAR);
      k_artistFormat->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
      g_renderTarget->DrawText(artist.c_str(), static_cast<UINT32>(artist.size()),
        k_artistFormat, artistRect, g_subTextBrush,
        D2D1_DRAW_TEXT_OPTIONS_NONE, DWRITE_MEASURING_MODE_GDI_CLASSIC);
    }

    // Lyrics (same line as artist, to the right of artist name)
    {
      float lyricsLeft = snapPixel(artistRight);
      float lyricsRight = snapPixel(contentRight);
      float lyricsH = kLyricsFontSize * 1.4f;
      float lyricsY = snapPixel(coverBottom - lyricsH);

      g_renderTarget->PushAxisAlignedClip(
        D2D1::RectF(lyricsLeft, lyricsY, lyricsRight, lyricsY + lyricsH),
        D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);

      std::wstring lyrics = state.lyrics;

      // Reset scroll animation when lyrics text changes
      if (lyrics != g_lastLyricsText) {
        g_lastLyricsText = lyrics;
        g_scrollTime = 0.0;
      }

      g_lyricsFormat->SetTextAlignment(DWRITE_TEXT_ALIGNMENT_LEADING);
      g_lyricsFormat->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
      g_lyricsFormat->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);

      bool recreateLyricsLayout = !g_lyricsLayout ||
        lyrics != g_cachedLyricsLayoutText ||
        fabsf(g_cachedLyricsDpiScale - g_dpiScale) > 0.001f;
      if (recreateLyricsLayout) {
        if (g_lyricsLayout) { g_lyricsLayout->Release(); g_lyricsLayout = nullptr; }
        g_cachedLyricsLayoutText = lyrics;
        g_cachedLyricsTextWidth = 0.0f;
        g_cachedLyricsDpiScale = g_dpiScale;

        g_writeFactory->CreateTextLayout(lyrics.c_str(), static_cast<UINT32>(lyrics.size()),
          g_lyricsFormat, 9999.0f, lyricsH, &g_lyricsLayout);
        if (g_lyricsLayout) {
          DWRITE_TEXT_METRICS metrics;
          g_lyricsLayout->GetMetrics(&metrics);
          g_cachedLyricsTextWidth = metrics.widthIncludingTrailingWhitespace;
        }
      }

      float availWidth = lyricsRight - lyricsLeft;
      float offsetX = 0.0f;
      bool shouldScroll = g_lyricsLayout && g_cachedLyricsTextWidth > availWidth;
      g_lyricsShouldAnimate = shouldScroll;
      if (shouldScroll) {
        float scrollDistance = g_cachedLyricsTextWidth - availWidth + 16.0f * g_dpiScale;
        float scrollSpeed = 25.0f * g_dpiScale;
        float scrollDuration = scrollDistance / scrollSpeed;
        float pauseDuration = 1.5f;
        float cycle = pauseDuration + scrollDuration + 0.5f;
        float t = static_cast<float>(fmod(g_scrollTime, cycle));
        if (t < pauseDuration) {
          offsetX = 0.0f;
        } else if (t < pauseDuration + scrollDuration) {
          offsetX = -((t - pauseDuration) * scrollSpeed);
        } else {
          offsetX = -scrollDistance;
        }
        offsetX = snapSubpixel(offsetX);
      }

      if (g_lyricsLayout) {
        g_renderTarget->DrawTextLayout(
          D2D1::Point2F(snapSubpixel(lyricsLeft + offsetX), lyricsY),
          g_lyricsLayout,
          g_lyricsBrush,
          D2D1_DRAW_TEXT_OPTIONS_NONE);
      }

      g_renderTarget->PopAxisAlignedClip();
    }
  } else {
    // No lyrics: title/artist takes full width
    if (contentRight > contentLeft + 40) {
      std::wstring title = state.title.empty() ? L"No Track" : state.title;
      std::wstring artist = state.artist;
      // Truncate artist to 14 chars
      if (artist.size() > 14) {
        artist = artist.substr(0, 14) + L"\u2026";
      }
      // Truncate title to fit available width
      title = truncateTextWithEllipsis(title, g_titleFormat, contentRight - contentLeft);
      float lineH = kArtistFontSize * 1.4f;
      float titleLineH = kTitleFontSize * 1.35f;
      D2D1_RECT_F titleRect = D2D1::RectF(contentLeft, titleTop, contentRight, titleTop + titleLineH);
      g_titleFormat->SetTextAlignment(DWRITE_TEXT_ALIGNMENT_LEADING);
      g_titleFormat->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_NEAR);
      g_titleFormat->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
      g_renderTarget->DrawText(title.c_str(), static_cast<UINT32>(title.size()),
        g_titleFormat, titleRect, g_textBrush,
        D2D1_DRAW_TEXT_OPTIONS_NONE, DWRITE_MEASURING_MODE_GDI_CLASSIC);
      D2D1_RECT_F artistRect = D2D1::RectF(contentLeft, coverBottom - lineH, contentRight, coverBottom);
      k_artistFormat->SetTextAlignment(DWRITE_TEXT_ALIGNMENT_LEADING);
      k_artistFormat->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_NEAR);
      k_artistFormat->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
      g_renderTarget->DrawText(artist.c_str(), static_cast<UINT32>(artist.size()),
        k_artistFormat, artistRect, g_subTextBrush,
        D2D1_DRAW_TEXT_OPTIONS_NONE, DWRITE_MEASURING_MODE_GDI_CLASSIC);
    }
  }

  // Progress bar at bottom
  float progressY = height - kProgressHeight;
  D2D1_RECT_F progressBack = D2D1::RectF(0, progressY, width, height);
  g_renderTarget->FillRectangle(progressBack, g_progressBackBrush);

  if (state.duration > 0.1 && state.position >= 0) {
    float ratio = static_cast<float>(state.position / state.duration);
    ratio = (ratio < 0) ? 0 : (ratio > 1) ? 1 : ratio;
    D2D1_RECT_F progress = D2D1::RectF(0, progressY, width * ratio, height);
    g_renderTarget->FillRectangle(progress, g_progressBrush);
  }

  HRESULT hr = g_renderTarget->EndDraw();
  if (hr == D2DERR_RECREATE_TARGET) {
    cleanupD2D();
    initD2D();
  }
}

// Button hit-testing

static int hitTestButton(int x, int y) {
  if (!g_hwnd) return -1;
  RECT rc;
  GetClientRect(g_hwnd, &rc);
  float width = static_cast<float>(rc.right - rc.left);
  float height = static_cast<float>(rc.bottom - rc.top);

  // Buttons are on the right side (no lyrics offset)
  float btnAreaW = snapPixel(kButtonSize * 3 + kPadding * 2);
  float btnAreaX = snapPixel(width - btnAreaW);
  float btnY = snapPixel((height - kButtonSize) / 2.0f);
  float prevX = btnAreaX;
  float playX = btnAreaX + kButtonSize + kPadding;
  float nextX = btnAreaX + (kButtonSize + kPadding) * 2;

  if (y >= static_cast<int>(btnY) && y <= static_cast<int>(btnY + kButtonSize)) {
    if (x >= static_cast<int>(prevX) && x <= static_cast<int>(prevX + kButtonSize)) return 0;
    if (x >= static_cast<int>(playX) && x <= static_cast<int>(playX + kButtonSize)) return 1;
    if (x >= static_cast<int>(nextX) && x <= static_cast<int>(nextX + kButtonSize)) return 2;
  }
  return -1;
}

// Fullscreen app detection

// Check if a specific window is fullscreen (covers entire monitor)
static bool isWindowFullscreen(HWND hwnd) {
  if (!hwnd || hwnd == g_hwnd) return false;

  wchar_t className[64] = {};
  GetClassNameW(hwnd, className, 63);
  if (wcscmp(className, L"Progman") == 0 || wcscmp(className, L"WorkerW") == 0)
    return false;

  if (!IsWindowVisible(hwnd)) return false;

  RECT wRect;
  if (!GetWindowRect(hwnd, &wRect)) return false;

  HMONITOR hMon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY);
  MONITORINFO mi = {};
  mi.cbSize = sizeof(mi);
  if (!GetMonitorInfoW(hMon, &mi)) return false;

  return (wRect.left <= mi.rcMonitor.left &&
          wRect.right >= mi.rcMonitor.right &&
          wRect.top <= mi.rcMonitor.top &&
          wRect.bottom >= mi.rcMonitor.bottom);
}

// Check if foreground window is fullscreen
static bool isForegroundFullscreen() {
  return isWindowFullscreen(GetForegroundWindow());
}

// Custom message for immediate topmost reassert (triggered by WinEvent hook)
#define WM_APP_REASSERT_TOPMOST (WM_APP + 1)
#define WM_APP_FAST_VISIBILITY   (WM_APP + 2)
#define WM_APP_APPBAR_NOTIFY     (WM_APP + 3)
#ifndef WM_MINIMIZEALL
#define WM_MINIMIZEALL 0x0316
#endif

static bool g_appBarRegistered = false;

// WinEvent callback: fires on foreground window change AND on object hide
static HWINEVENTHOOK g_winEventHook = nullptr;
static HWINEVENTHOOK g_objHideHook = nullptr;
static HWINEVENTHOOK g_locationHook = nullptr;
static UINT_PTR g_fastTimerId = 0;

static VOID CALLBACK winEventCallback(
  HWINEVENTHOOK hWinEventHook, DWORD event, HWND hwnd,
  LONG idObject, LONG idChild, DWORD dwEventThread, DWORD dwmsEventTime)
{
  (void)hWinEventHook;
  (void)idObject;
  (void)idChild;
  (void)dwEventThread;
  (void)dwmsEventTime;

  if (!g_hwnd) return;
  // Foreground change (Win+D, alt-tab, click other window)
  if (event == EVENT_SYSTEM_FOREGROUND) {
    bool fs = isForegroundFullscreen();
    if (fs) {
      // Fullscreen window exists; set flag FIRST, then hide
      g_isFullscreen = true;
      if (g_hwnd) ShowWindow(g_hwnd, SW_HIDE);
    } else {
      g_isFullscreen = false;
      PostMessage(g_hwnd, WM_APP_REASSERT_TOPMOST, 0, 0);
    }
  }
  // Location/size change; recheck fullscreen (catches F11, maximize, etc.)
  if (event == EVENT_OBJECT_LOCATIONCHANGE && hwnd != g_hwnd) {
    bool fs = isForegroundFullscreen();
    if (fs && !g_isFullscreen) {
      // Just entered fullscreen; set flag FIRST, then hide
      g_isFullscreen = true;
      if (g_hwnd) ShowWindow(g_hwnd, SW_HIDE);
    } else if (!fs && g_isFullscreen) {
      // Just exited fullscreen
      g_isFullscreen = false;
      if (g_visible) PostMessage(g_hwnd, WM_APP_REASSERT_TOPMOST, 0, 0);
    }
  }
  // Our window or any window in our process got hidden; re-show immediately
  // (but NOT if we are in fullscreen mode; we want to stay hidden)
  if (event == EVENT_OBJECT_HIDE && hwnd == g_hwnd && !g_isFullscreen) {
    PostMessage(g_hwnd, WM_APP_FAST_VISIBILITY, 0, 0);
  }
}

static void assertTopmost() {
  if (!g_hwnd) return;
  // Only reassert Z-order, do NOT use SWP_SHOWWINDOW here
  // to avoid triggering repaints on already-visible windows
  SetWindowPos(g_hwnd, HWND_TOPMOST, 0, 0, 0, 0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER |
    SWP_NOSENDCHANGING);

  // Win11 Start Menu / Search / Shell Flyouts use a higher DWM layer.
  // HWND_TOPMOST Z-order alone cannot beat them.
  // Try using BringWindowToTop which forces the window to the top of its Z group.
  BringWindowToTop(g_hwnd);
}

static void forceShowTopmost() {
  if (!g_hwnd) return;
  // For child windows (parented to WorkerW), ShowWindow is the reliable way.
  // SetWindowPos with HWND_TOPMOST is ignored for child windows but doesn't hurt.
  ShowWindow(g_hwnd, SW_SHOWNOACTIVATE);
  SetWindowPos(g_hwnd, HWND_TOPMOST, 0, 0, 0, 0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER |
    SWP_NOSENDCHANGING);
}

static void animationLoop() {
  HANDLE timer = CreateWaitableTimerW(nullptr, FALSE, nullptr);
  if (!timer) return;

  LARGE_INTEGER dueTime = {};
  dueTime.QuadPart = -static_cast<LONGLONG>(kRenderIntervalMs) * 10000LL;
  SetWaitableTimer(timer, &dueTime, kRenderIntervalMs, nullptr, nullptr, FALSE);

  ULONGLONG lastTick = GetTickCount64();
  while (g_running) {
    DWORD wait = WaitForSingleObject(timer, 100);
    if (wait != WAIT_OBJECT_0) continue;

    ULONGLONG now = GetTickCount64();
    double delta = static_cast<double>(now - lastTick) / 1000.0;
    lastTick = now;
    if (delta > 0.05) delta = 0.05;

    bool animate = false;
    {
      std::lock_guard<std::mutex> lock(g_stateMutex);
      animate = g_visible && !g_isFullscreen && g_lyricsShouldAnimate.load();
      if (animate) {
        g_scrollTime += delta;
      } else {
        g_lastRenderTick = now;
      }
    }

    if (animate && g_hwnd) InvalidateRect(g_hwnd, nullptr, FALSE);
  }

  CancelWaitableTimer(timer);
  CloseHandle(timer);
}
// Window procedure

static void repositionWindow(); // forward declaration
static bool updateLayoutIfChanged();

static LRESULT CALLBACK wndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  switch (msg) {
    case WM_PAINT:
      render();
      ValidateRect(hwnd, nullptr);
      return 0;

    case WM_ERASEBKGND:
      return 1;

    case WM_MOUSEMOVE: {
      int btn = hitTestButton(GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam));
      if (btn != g_hoveredButton) {
        g_hoveredButton = btn;
        InvalidateRect(hwnd, nullptr, FALSE);
      }
      TRACKMOUSEEVENT tme = {};
      tme.cbSize = sizeof(tme);
      tme.dwFlags = TME_LEAVE;
      tme.hwndTrack = hwnd;
      TrackMouseEvent(&tme);
      return 0;
    }

    case WM_MOUSELEAVE:
      g_hoveredButton = -1;
      InvalidateRect(hwnd, nullptr, FALSE);
      return 0;

    case WM_LBUTTONDOWN: {
      int btn = hitTestButton(GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam));
      if (btn == 0) sendJson("{\"type\":\"click\",\"action\":\"prev\"}");
      else if (btn == 1) sendJson("{\"type\":\"click\",\"action\":\"playPause\"}");
      else if (btn == 2) sendJson("{\"type\":\"click\",\"action\":\"next\"}");
      return 0;
    }

    case WM_LBUTTONDBLCLK: {
      int btn = hitTestButton(GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam));
      if (btn < 0) {
        sendJson("{\"type\":\"doubleClick\"}");
      }
      return 0;
    }

    case WM_SIZE:
      resizeRenderTarget();
      InvalidateRect(hwnd, nullptr, FALSE);
      return 0;

    case WM_DPICHANGED: {
      // System DPI scale changed; update layout and reposition
      UINT newDpi = HIWORD(wParam);
      g_dpiScale = newDpi / 96.0f;
      applyDpiScale();
      recreateTextFormats();
      // Update render target DPI
      if (g_renderTarget) {
        g_renderTarget->SetDpi(96.0f, 96.0f);
        applyTextRenderingSettings();
      }
      // Force cover bitmap reload (bound to old render target state)
      g_loadedCoverPath.clear();
      // Reposition with new DPI-scaled dimensions
      repositionWindow();
      return 0;
    }

    case WM_TIMER:
      if (wParam == kPollTimerId) {
        updateLayoutIfChanged();

        // Check fullscreen state
        bool wasFullscreen = g_isFullscreen;
        g_isFullscreen = isForegroundFullscreen();

        if (g_isFullscreen && !wasFullscreen) {
          // Entered fullscreen; hide immediately
          ShowWindow(g_hwnd, SW_HIDE);
        } else if (!g_isFullscreen && wasFullscreen) {
          // Exited fullscreen; show immediately
          if (g_visible) forceShowTopmost();
        }

        if (g_visible && !g_isFullscreen && !IsWindowVisible(g_hwnd)) forceShowTopmost();
      } else if (wParam == g_fastTimerId) {
        // Fast visibility check: recover only if the shell actually hid us.
        // Reasserting z-order every 16ms fights DWM composition and can make
        // scrolling text shimmer or flicker.
        if (g_visible && !g_isFullscreen && !IsWindowVisible(g_hwnd)) {
          forceShowTopmost();
        }
      } else if (wParam == kColorTimerId) {
        sampleTaskbarColor();
        if (!g_isFullscreen) InvalidateRect(hwnd, nullptr, FALSE);
      }
      return 0;

    case WM_APP_REASSERT_TOPMOST:
      // Foreground changed (Win+D, alt-tab); reassert Z-order
      if (g_visible && !g_isFullscreen) {
        if (!IsWindowVisible(g_hwnd)) forceShowTopmost();
        else assertTopmost();
      }
      return 0;

    case WM_APP_FAST_VISIBILITY:
      // Our window was hidden (EVENT_OBJECT_HIDE); show immediately
      if (g_visible && !g_isFullscreen) forceShowTopmost();
      return 0;

    case WM_WINDOWPOSCHANGING: {
      // Prevent the OS from hiding or lowering our z-order
      // BUT allow hiding when:
      //   1. We're in fullscreen mode, OR
      //   2. User explicitly requested hide (g_visible = false)
      WINDOWPOS* wp = reinterpret_cast<WINDOWPOS*>(lParam);
      if (wp && !g_isFullscreen && g_visible) {
        wp->flags &= ~SWP_HIDEWINDOW;
        wp->flags |= SWP_SHOWWINDOW;
        wp->hwndInsertAfter = HWND_TOPMOST;
        // Also prevent minimize and deactivate
        wp->flags &= ~SWP_NOACTIVATE;
      }
      return 0;
    }

    case WM_SETTINGCHANGE: {
      const bool hasArea = lParam != 0;
      const bool colorChanged = hasArea && wcscmp(reinterpret_cast<LPCWSTR>(lParam), L"ImmersiveColorSet") == 0;
      if (colorChanged) {
        sampleTaskbarColor();
        InvalidateRect(hwnd, nullptr, FALSE);
      }
      repositionWindow();
      return 0;
    }

    case WM_MINIMIZEALL:
      // Win+D "Minimize All"; ignore completely
      return 0;

    case WM_QUERYOPEN:
      // Prevent restore animation flicker
      return 1;

    case WM_SYSCOMMAND:
      // Reject SC_MINIMIZE to prevent the minimize/restore flicker loop
      if ((wParam & 0xFFF0) == SC_MINIMIZE) return 0;
      break;

    case WM_SHOWWINDOW:
      // When the OS tries to hide us, immediately reshow
      // BUT NOT when we're in fullscreen mode
      if (wParam == FALSE && lParam == SW_PARENTCLOSING && !g_isFullscreen) return 0;
      break;

    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;

    default:
      return DefWindowProc(hwnd, msg, wParam, lParam);
  }

  return DefWindowProc(hwnd, msg, wParam, lParam);
}

// Window creation

// Recalculate window position and size based on taskbar geometry
static bool boundsEqual(const HostWindowBounds& a, const HostWindowBounds& b) {
  return a.x == b.x && a.y == b.y && a.width == b.width && a.height == b.height;
}

static bool updateLayoutIfChanged() {
  if (!g_hwnd) return false;

  HostWindowBounds bounds = calculateHostWindowBounds(g_hwnd);
  if (g_lastBoundsValid && boundsEqual(bounds, g_lastBounds)) {
    return false;
  }

  g_lastBounds = bounds;
  g_lastBoundsValid = true;
  SetWindowPos(g_hwnd, HWND_TOPMOST, bounds.x, bounds.y, bounds.width, bounds.height,
    SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING);
  resizeRenderTarget();
  InvalidateRect(g_hwnd, nullptr, FALSE);
  return true;
}

static void repositionWindow() {
  g_lastBoundsValid = false;
  updateLayoutIfChanged();
}

static bool createWindow(HINSTANCE hInstance) {
  WNDCLASSEXW wc = {};
  wc.cbSize = sizeof(wc);
  wc.style = CS_DBLCLKS;
  wc.lpfnWndProc = wndProc;
  wc.hInstance = hInstance;
  wc.lpszClassName = kWindowClass;
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);

  ATOM wcAtom = RegisterClassExW(&wc);
  if (!wcAtom) return false;

  // Get initial DPI scale for window size calculation
  HMONITOR hmon = MonitorFromWindow(nullptr, MONITOR_DEFAULTTOPRIMARY);
  UINT dpi = 96;
  GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, &dpi, &dpi);
  g_dpiScale = dpi / 96.0f;
  applyDpiScale();


  HostWindowBounds bounds = calculateHostWindowBounds(nullptr);
  g_lastBounds = bounds;
  g_lastBoundsValid = true;
  int x = bounds.x;
  int y = bounds.y;
  int width = bounds.width;
  int height = bounds.height;
  const DWORD experimentalBand = resolveExperimentalWindowBand();
  const DWORD windowExStyle = WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST;
  bool createdWithBand = false;

  if (experimentalBand != kNoExperimentalWindowBand) {
    using CreateWindowInBandFn = HWND (WINAPI *)(DWORD, ATOM, LPCWSTR, DWORD, int, int, int, int, HWND, HMENU, HINSTANCE, LPVOID, DWORD);
    HMODULE user32 = GetModuleHandleW(L"user32.dll");
    auto createWindowInBand = user32
      ? reinterpret_cast<CreateWindowInBandFn>(GetProcAddress(user32, "CreateWindowInBand"))
      : nullptr;

    if (createWindowInBand) {
      SetLastError(ERROR_SUCCESS);
      g_hwnd = createWindowInBand(windowExStyle, wcAtom, kWindowTitle, WS_POPUP,
        x, y, width, height, nullptr, nullptr, hInstance, nullptr, experimentalBand);
      if (g_hwnd) {
        char msg[160];
        sprintf_s(msg, "Created experimental window band=%lu", experimentalBand);
        logHostMsg(msg);
        createdWithBand = true;
        fprintf(stderr, "[taskbar-host] Created experimental window band=%lu\n", experimentalBand);
      } else {
        DWORD err = GetLastError();
        char msg[192];
        sprintf_s(msg, "CreateWindowInBand band=%lu failed: %lu; falling back", experimentalBand, err);
        logHostMsg(msg);
        fprintf(stderr, "[taskbar-host] CreateWindowInBand band=%lu failed: %lu; falling back\n",
          experimentalBand, err);
      }
    } else {
      logHostMsg("CreateWindowInBand unavailable; falling back");
      fprintf(stderr, "[taskbar-host] CreateWindowInBand unavailable; falling back\n");
    }
  }

  if (!g_hwnd) {
    g_hwnd = CreateWindowExW(
      windowExStyle,
      kWindowClass, kWindowTitle,
      WS_POPUP,
      x, y, width, height,
      nullptr, nullptr, hInstance, nullptr);
  }

  if (!g_hwnd) {
    logHostMsg("Create taskbar host window failed");
    return false;
  }

  if (experimentalBand != kNoExperimentalWindowBand) {
    logHostMsg(createdWithBand ? "Taskbar host window ready in experimental band" : "Taskbar host window ready after fallback");
  }

  // Enable DWM per-pixel alpha transparency (without WS_EX_LAYERED).
  // DwmExtendFrameIntoClientArea with margins={-1} makes the entire window
  // a DWM glass surface; Direct2D can render with premultiplied alpha if needed.
  // and DWM will composite it with per-pixel transparency.
  MARGINS margins = { -1 };
  DwmExtendFrameIntoClientArea(g_hwnd, &margins);

  if (!initD2D()) return false;

  ShowWindow(g_hwnd, SW_SHOWNOACTIVATE);
  SetWindowPos(g_hwnd, HWND_TOPMOST, 0, 0, 0, 0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

  // Register as AppBar; Shell will not hide AppBar windows during Win+D
  APPBARDATA abd = {};
  abd.cbSize = sizeof(abd);
  abd.hWnd = g_hwnd;
  abd.uCallbackMessage = WM_APP_APPBAR_NOTIFY;
  g_appBarRegistered = (SHAppBarMessage(ABM_NEW, &abd) != 0);

  return true;
}

// IPC thread

static void ipcThread() {
  std::string line;
  while (g_running) {
    int c = EOF;
    line.clear();
    while (g_running && (c = getchar()) != EOF && c != '\n') {
      line += static_cast<char>(c);
    }
    if (c == EOF && line.empty()) break;
    if (line.empty()) continue;

    std::string type = extractJsonString(line, "type");
    if (type == "state") {
      std::string title = extractJsonString(line, "title");
      std::string artist = extractJsonString(line, "artist");
      std::string lyrics = extractJsonString(line, "lyrics");
      std::string coverPath = extractJsonString(line, "coverPath");
      bool playing = extractJsonBool(line, "playing");
      double position = extractJsonNumber(line, "position");
      double duration = extractJsonNumber(line, "duration");

      {
        std::lock_guard<std::mutex> lock(g_stateMutex);
        g_state.title = title.empty() ? L"No Track" : utf8ToWide(title);
        g_state.artist = utf8ToWide(artist);
        std::wstring newLyrics = utf8ToWide(lyrics);
        if (newLyrics != g_state.lyrics) {
          g_scrollTime = 0.0;
          g_lastLyricsText.clear();
          g_lyricsShouldAnimate = false;
        }
        g_state.lyrics = newLyrics;
        g_state.coverPath = utf8ToWide(coverPath);
        g_state.playing = playing;
        g_state.position = position;
        g_state.duration = duration;
      }
      if (g_hwnd) InvalidateRect(g_hwnd, nullptr, FALSE);
    } else if (type == "show") {
      g_visible = true;
      if (g_hwnd) {
        ShowWindow(g_hwnd, SW_SHOWNOACTIVATE);
        SetWindowPos(g_hwnd, HWND_TOPMOST, 0, 0, 0, 0,
          SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
      }
    } else if (type == "hide") {
      g_visible = false;
      if (g_hwnd) ShowWindow(g_hwnd, SW_HIDE);
    } else if (type == "quit") {
      g_running = false;

      if (g_hwnd) PostMessage(g_hwnd, WM_CLOSE, 0, 0);
      break;
    }
  }
  g_running = false;

}

// Main

int main() {
  // Set DPI awareness BEFORE creating any windows or Direct2D resources
  // This is the critical fix for blurry rendering on high-DPI displays
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  CoInitialize(nullptr);

  HINSTANCE hInstance = GetModuleHandle(nullptr);

  if (!createWindow(hInstance)) {
    return 1;
  }

  sendJson("{\"type\":\"ready\"}");

  std::thread ipc(ipcThread);
  g_animationThread = std::thread(animationLoop);

  // Sample taskbar color immediately, then every 5 seconds
  sampleTaskbarColor();
  SetTimer(g_hwnd, kPollTimerId, kPollIntervalMs, nullptr);
  SetTimer(g_hwnd, kColorTimerId, kColorIntervalMs, nullptr);

  // Install WinEvent hooks for immediate topmost reassert
  // Hook 1: foreground change (Win+D, alt-tab, window switch)
  g_winEventHook = SetWinEventHook(
    EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND,
    nullptr, winEventCallback,
    0, 0,
    WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);

  // Hook 2: object hide (catches when our window gets hidden by OS)
  g_objHideHook = SetWinEventHook(
    EVENT_OBJECT_HIDE, EVENT_OBJECT_HIDE,
    nullptr, winEventCallback,
    GetCurrentProcessId(), 0,
    WINEVENT_OUTOFCONTEXT);

  // Hook 3: location/size change; catches F11 fullscreen, maximize, etc.
  // (these don't trigger EVENT_SYSTEM_FOREGROUND since the window is already foreground)
  g_locationHook = SetWinEventHook(
    EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE,
    nullptr, winEventCallback,
    0, 0,
    WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);

  // Fast visibility-check timer (16ms / 60fps): checks IsWindowVisible only,
  // only calls SetWindowPos when window is actually hidden. Near-zero overhead.
  g_fastTimerId = 100;
  SetTimer(g_hwnd, g_fastTimerId, 16, nullptr);

  MSG msg;
  while (g_running && GetMessage(&msg, nullptr, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessage(&msg);
  }

  g_running = false;

  if (g_animationThread.joinable()) {
    g_animationThread.join();
  }

  if (g_winEventHook) {
    UnhookWinEvent(g_winEventHook);
    g_winEventHook = nullptr;
  }
  if (g_objHideHook) {
    UnhookWinEvent(g_objHideHook);
    g_objHideHook = nullptr;
  }
  if (g_locationHook) {
    UnhookWinEvent(g_locationHook);
    g_locationHook = nullptr;
  }

  // Unregister AppBar
  if (g_appBarRegistered && g_hwnd) {
    APPBARDATA abd = {};
    abd.cbSize = sizeof(abd);
    abd.hWnd = g_hwnd;
    SHAppBarMessage(ABM_REMOVE, &abd);
    g_appBarRegistered = false;
  }

  if (g_hwnd) {
    DestroyWindow(g_hwnd);
    g_hwnd = nullptr;
  }

  cleanupD2D();
  UnregisterClassW(kWindowClass, hInstance);
  CoUninitialize();

  if (ipc.joinable()) ipc.detach();

  return 0;
}
